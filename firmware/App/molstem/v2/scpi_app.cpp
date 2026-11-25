/*
 * scpi_app — SCPI-style serial API of the thermocycler application.
 * Contract: docs/serial-api.md ("Application commands").
 *
 * Threads:
 *   uart_bridge (USB CDC)  → scpi_app_usb_feed()  → usb_tx_line()
 *   ESP tick (usb_logging) → scpi_app_host_pump() → esp_io_host_response()
 * Both dispatch through the same command table under `scpi_mutex`. Commands
 * that change the run state (PROT:STAR / PROT:STOP) are executed on the
 * TUI/scheduler thread via a static mailbox + microtask (`scpi_apply_task`).
 *
 * No heap in these paths: contexts, buffers and RTOS objects are static (the
 * only allocation is the coroutine frame the microtask scheduler needs).
 */
#include <cmath>
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstring>

#include "scpi_app.h"
#include "helpers/scpi_line.h"
#include "helpers/microtask_scheduler.hpp"
#include "control/control.hpp"
#include "tui.h"
#include "esp_io.h"
#include "git-version.h"

extern "C" {
	#include "cmsis_os2.h"
	#include "usbd_cdc_if.h"
	#include "adc.h"
	#include "pcr.h"
	#include "control/temp_control_pid.h"
	#include "drivers/lcd.h"
}

/* ---- externals ---- */

extern USBD_HandleTypeDef hUsbDeviceFS;
extern microtask::MicrotaskScheduler scheduler;
extern volatile uint8_t provision_status;   /* main.cpp: 0 unprovisioned, 1 development, 2 production, 255 unknown */
extern unsigned wifi;                        /* main.cpp */
extern unsigned buzzer;                      /* main.cpp */
extern temp_pid_coef_t temp_coef;
extern char front_buffer[LCD_ROWS][LCD_COLS];  /* renderer.cpp */
extern volatile int32_t encoder_counter;              /* drivers/rotary.cpp */
extern volatile uint8_t encoder_button_state;
extern volatile uint32_t encoder_button_last_press_time;

/* ---- RTOS objects (static) ---- */

static StaticSemaphore_t scpi_mutex_storage;
static SemaphoreHandle_t scpi_mutex;          /* serialises dispatch (USB thread vs ESP tick thread) */

static StaticSemaphore_t usb_tx_mutex_storage;
static SemaphoreHandle_t usb_tx_mutex;

static StaticSemaphore_t apply_done_storage;
static SemaphoreHandle_t apply_done;          /* given by scpi_apply_task() on the TUI thread */

/* ---- contexts ---- */

static scpi_ctx_t usb_ctx;
static scpi_ctx_t host_ctx;

static volatile bool reset_pending;           /* *RST: reply first, then reset */

static char serial_cache[35];
static char uid_text[25];

/* ---- scheduler mailbox (PROT:STAR / PROT:STOP) ---- */

enum {
	REQ_NONE = 0,
	REQ_START,
	REQ_STOP,
};

struct scpi_request_t {
	volatile uint8_t kind;
	float peltier[stages_num];
	uint16_t time[stages_num];
	uint16_t cycles;
	char name[33];
	char comment[65];
	int result;                 /* SCPI_OK or error code */
	char msg[48];               /* optional error message */
};

static scpi_request_t request;

#define APPLY_TIMEOUT_MS 500

/* ---- USB CDC output ---- */

static char usb_tx_buf[SCPI_OUT_MAX + 2];   /* line + optional pad + '\n' */

static bool usb_tx_wait_idle() {
	for (unsigned waited_ms = 0; waited_ms < 100; waited_ms++) {
		if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED) {
			return false;
		}
		USBD_CDC_HandleTypeDef* hcdc = (USBD_CDC_HandleTypeDef*)hUsbDeviceFS.pClassData;
		if (hcdc == nullptr) {
			return false;
		}
		if (hcdc->TxState == 0) {
			return true;
		}
		osDelay(1);
	}
	return false;
}

void usb_tx_line(const char* line) {
	if (hUsbDeviceFS.dev_state != USBD_STATE_CONFIGURED) {
		return;
	}

	xSemaphoreTake(usb_tx_mutex, portMAX_DELAY);

	// CDC_Transmit_FS keeps our pointer: the previous transfer must have
	// completed before the static buffer is overwritten.
	if (usb_tx_wait_idle()) {
		size_t n = strlen(line);
		if (n > SCPI_OUT_MAX - 1) {
			n = SCPI_OUT_MAX - 1;
		}
		memcpy(usb_tx_buf, line, n);
		if (((n + 1) % 64) == 0) {
			usb_tx_buf[n++] = ' ';   // avoid a 64-byte multiple (ZLP stall on some hosts)
		}
		usb_tx_buf[n++] = '\n';
		CDC_Transmit_FS((uint8_t*)usb_tx_buf, (uint16_t)n);
	}

	xSemaphoreGive(usb_tx_mutex);
}

/* ---- helpers ---- */

static const char* serial_text() {
	if (serial_cache[0] != '\0') {
		return serial_cache;
	}
	if (uid_text[0] == '\0') {
		snprintf(uid_text, sizeof(uid_text), "%08lX%08lX%08lX",
			(unsigned long)HAL_GetUIDw0(), (unsigned long)HAL_GetUIDw1(), (unsigned long)HAL_GetUIDw2());
	}
	return uid_text;
}

void scpi_app_set_serial(const char* serial) {
	strncpy(serial_cache, serial ? serial : "", sizeof(serial_cache) - 1);
	serial_cache[sizeof(serial_cache) - 1] = '\0';
}

static void format_target(char* buf, size_t cap, float value) {
	if (value == TARGET_DISABLED) {
		snprintf(buf, cap, "NONE");
	} else {
		snprintf(buf, cap, "%.1f", (double)value);
	}
}

static void do_reset_if_pending() {
	if (reset_pending) {
		osDelay(50);
		NVIC_SystemReset();
	}
}

/* Runs on the TUI/scheduler thread. */
static int apply_request(uint8_t kind) {
	if (kind == REQ_STOP) {
		return tui_request_abort() ? SCPI_OK : SCPI_ERR_NOT_RUNNING;
	}

	// REQ_START
	if (!tui_can_start_run()) {
		return SCPI_ERR_NOT_IDLE;
	}

	if (request.cycles < operation_definition.min_cycles || request.cycles > operation_definition.max_cycles) {
		snprintf(request.msg, sizeof(request.msg), "cycles out of range");
		return SCPI_ERR_OUT_OF_RANGE;
	}
	for (int i = 0; i < stages_num; i++) {
		const stage_configuration_t& stage = operation_definition.stages[i];
		if (request.peltier[i] < stage.min_peltier || request.peltier[i] > stage.max_peltier) {
			snprintf(request.msg, sizeof(request.msg), "%s temp out of range", stage_name[i]);
			return SCPI_ERR_OUT_OF_RANGE;
		}
		if (request.time[i] < stage.min_time || request.time[i] > stage.max_time) {
			snprintf(request.msg, sizeof(request.msg), "%s time out of range", stage_name[i]);
			return SCPI_ERR_OUT_OF_RANGE;
		}
	}

	operation_definition.cycles = request.cycles;
	for (int i = 0; i < stages_num; i++) {
		operation_definition.stages[i].peltier = request.peltier[i];
		operation_definition.stages[i].time = request.time[i];
	}

	on_tui_in_operation();   // resets run_meta (start tick, empty name/comment) and queues the run

	taskENTER_CRITICAL();
	memcpy(run_meta.name, request.name, sizeof(run_meta.name));
	memcpy(run_meta.comment, request.comment, sizeof(run_meta.comment));
	taskEXIT_CRITICAL();

	return SCPI_OK;
}

static microtask::Task scpi_apply_task() {
	taskENTER_CRITICAL();
	uint8_t kind = request.kind;
	request.kind = REQ_NONE;
	taskEXIT_CRITICAL();

	if (kind != REQ_NONE) {          // REQ_NONE: the requester already timed out
		request.result = apply_request(kind);
		xSemaphoreGive(apply_done);
	}
	co_return;
}

/* Called under scpi_mutex from the dispatching thread. */
static int submit_request(uint8_t kind, char* out, size_t cap) {
	xSemaphoreTake(apply_done, 0);   // drop a stale completion

	request.result = SCPI_OK;
	request.msg[0] = '\0';
	taskENTER_CRITICAL();
	request.kind = kind;
	taskEXIT_CRITICAL();

	scheduler.queue_task(scpi_apply_task());

	BaseType_t done = xSemaphoreTake(apply_done, pdMS_TO_TICKS(APPLY_TIMEOUT_MS));
	if (done != pdTRUE) {
		taskENTER_CRITICAL();
		bool in_progress = request.kind == REQ_NONE;   // picked up, still executing
		request.kind = REQ_NONE;                        // otherwise: withdraw it
		taskEXIT_CRITICAL();
		if (in_progress) {
			done = xSemaphoreTake(apply_done, pdMS_TO_TICKS(APPLY_TIMEOUT_MS));
		}
		if (done != pdTRUE) {
			return SCPI_ERR_TIMEOUT;
		}
	}

	if (request.result != SCPI_OK && request.msg[0] != '\0') {
		snprintf(out, cap, "%s", request.msg);
	}
	return request.result;
}

/* ---- command handlers ---- */

static int cmd_idn(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	snprintf(out, cap, "molstem,thermocycler,%s,%s", serial_text(), GIT_VERSION);
	return SCPI_OK;
}

static int cmd_rst(scpi_ctx_t*, const scpi_args_t* args, char*, size_t) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	reset_pending = true;   // reply "OK" first; the caller resets after emitting
	return SCPI_OK;
}

static int cmd_stat(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	tui_run_snapshot_t s;
	tui_get_run_snapshot(&s);
	if (s.running) {
		snprintf(out, cap, "RUNNING");
	} else if (s.ready && !s.pid_tune) {
		snprintf(out, cap, "IDLE");
	} else {
		snprintf(out, cap, "BUSY");
	}
	return SCPI_OK;
}

static int cmd_prot_star(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	// "<name>","<comment>",<cycles>,<introT>,<introS>,<denT>,<denS>,<annT>,<annS>,<extT>,<extS>,<finT>,<finS>
	if (args->count != 3 + 2 * stages_num) {
		return SCPI_ERR_ARG_COUNT;
	}
	if (strlen(args->argv[0]) > sizeof(request.name) - 1) {
		snprintf(out, cap, "name too long");
		return SCPI_ERR_ARG_VALUE;
	}
	if (strlen(args->argv[1]) > sizeof(request.comment) - 1) {
		snprintf(out, cap, "comment too long");
		return SCPI_ERR_ARG_VALUE;
	}

	long cycles;
	if (!scpi_arg_int(args, 2, &cycles) || cycles < 0 || cycles > 0xFFFF) {
		snprintf(out, cap, "bad cycles");
		return SCPI_ERR_ARG_VALUE;
	}

	float temps[stages_num];
	uint16_t times[stages_num];
	for (int i = 0; i < stages_num; i++) {
		long seconds;
		if (!scpi_arg_float(args, (uint8_t)(3 + 2 * i), &temps[i]) || !std::isfinite(temps[i])) {
			snprintf(out, cap, "bad %s temp", stage_name[i]);
			return SCPI_ERR_ARG_VALUE;
		}
		if (!scpi_arg_int(args, (uint8_t)(4 + 2 * i), &seconds) || seconds < 0 || seconds > 0xFFFF) {
			snprintf(out, cap, "bad %s time", stage_name[i]);
			return SCPI_ERR_ARG_VALUE;
		}
		times[i] = (uint16_t)seconds;
	}

	strncpy(request.name, args->argv[0], sizeof(request.name) - 1);
	request.name[sizeof(request.name) - 1] = '\0';
	strncpy(request.comment, args->argv[1], sizeof(request.comment) - 1);
	request.comment[sizeof(request.comment) - 1] = '\0';
	request.cycles = (uint16_t)cycles;
	for (int i = 0; i < stages_num; i++) {
		request.peltier[i] = temps[i];
		request.time[i] = times[i];
	}

	return submit_request(REQ_START, out, cap);
}

static int cmd_prot_stop(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	return submit_request(REQ_STOP, out, cap);
}

static const char* const phase_names[stages_num] = {
	"INTRO_DENATURING", "DENATURING", "ANNEALING", "EXTENSION", "FINAL_EXTENSION"
};

static int cmd_prot_cycl(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}

	tui_run_snapshot_t s;
	tui_get_run_snapshot(&s);
	if (!s.running) {
		return SCPI_ERR_NOT_RUNNING;
	}

	int stage = -1;
	for (int i = 0; i < stages_num; i++) {
		if (s.phase_text == stage_name[i]) {
			stage = i;
		}
	}

	const char* phase;
	if (s.completed) {
		phase = "COMPLETED";
	} else if (s.canceled) {
		phase = "ABORTING";
	} else if (stage >= 0) {
		phase = phase_names[stage];
	} else {
		phase = "LID_PREHEAT";   // "Lid pre-heating" / "starting up"
	}

	// cycle: 0 before the cycled stages, 1-based inside them, total_cycles after them
	unsigned total_cycles = operation_definition.cycles;
	unsigned cycle;
	if (s.completed || stage == stage_final_extension) {
		cycle = total_cycles;
	} else if (stage >= stage_denaturing && stage <= stage_extension) {
		cycle = s.current_cycle + 1u;
	} else {
		cycle = 0;
	}

	char remaining[16];
	if (s.remaining_seconds == (unsigned)PROGRESS_HEATING_LID) {
		snprintf(remaining, sizeof(remaining), "HEATING_LID");
	} else if (s.remaining_seconds == (unsigned)PROGRESS_HEATING) {
		snprintf(remaining, sizeof(remaining), "HEATING");
	} else if (s.remaining_seconds == (unsigned)PROGRESS_COOLING) {
		snprintf(remaining, sizeof(remaining), "COOLING");
	} else {
		snprintf(remaining, sizeof(remaining), "%u", s.remaining_seconds);
	}

	control_status_t cs;
	control_get_status(&cs);
	char peltier_target[12], lid_target[12];
	format_target(peltier_target, sizeof(peltier_target), cs.peltier_temperature_target);
	format_target(lid_target, sizeof(lid_target), cs.lid_temperature_target);

	uint32_t start_tick;
	taskENTER_CRITICAL();
	start_tick = run_meta.start_tick;
	taskEXIT_CRITICAL();
	unsigned long elapsed_s = (unsigned long)((HAL_GetTick() - start_tick) / 1000u);

	snprintf(out, cap, "%s,%u,%u,%s,%.1f,%s,%.1f,%s,%lu,%d",
		phase, cycle, total_cycles, remaining,
		(double)cs.peltier_temperature_filtered, peltier_target,
		(double)cs.lid_temperature_filtered, lid_target,
		elapsed_s, s.total_time_s);
	return SCPI_OK;
}

static int cmd_prot_def(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}

	pcr_run_meta_t meta;
	taskENTER_CRITICAL();
	memcpy(&meta, &run_meta, sizeof(meta));
	taskEXIT_CRITICAL();
	meta.name[sizeof(meta.name) - 1] = '\0';
	meta.comment[sizeof(meta.comment) - 1] = '\0';

	size_t pos = 0;
	scpi_out_quoted(out, cap, &pos, meta.name);
	if (pos + 1 < cap) {
		out[pos++] = ',';
	}
	scpi_out_quoted(out, cap, &pos, meta.comment);

	int n = snprintf(out + pos, cap - pos, ",%u", (unsigned)operation_definition.cycles);
	if (n > 0) {
		pos += (size_t)n < cap - pos ? (size_t)n : cap - pos - 1;
	}
	for (int i = 0; i < stages_num && pos < cap; i++) {
		n = snprintf(out + pos, cap - pos, ",%.1f,%u",
			(double)operation_definition.stages[i].peltier, (unsigned)operation_definition.stages[i].time);
		if (n > 0) {
			pos += (size_t)n < cap - pos ? (size_t)n : cap - pos - 1;
		}
	}
	return SCPI_OK;
}

static int cmd_hw(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}

	control_status_t cs;
	control_get_status(&cs);

	uint16_t adc_pelt_i, adc_lid_t, adc_pelt_t, adc_lid_i;
	ADC_GetValues(&adc_pelt_i, &adc_lid_t, &adc_pelt_t, &adc_lid_i);

	snprintf(out, cap,
		"pelt_i=%.3f,pelt_t=%.2f,pelt_t_set=%.2f,pelt_i_set=%.3f,"
		"lid_i=%.3f,lid_t=%.2f,lid_t_set=%.2f,"
		"hb_v_set=%.2f,hb_duty=%.4f,osc_ms=%lu,"
		"pid_p=%.4f,pid_i=%.4f,pid_d=%.4f,"
		"adc_pelt_i=%u,adc_lid_t=%u,adc_pelt_t=%u,adc_lid_i=%u,"
		"kp=%.4f,ti=%.4f,td=%.4f,tf=%.4f,kb=%.4f,"
		"prov=%u,wifi=%u,buzzer=%u,uptime_s=%lu,heap_free=%u",
		(double)cs.peltier_current_filtered, (double)cs.peltier_temperature_filtered,
		(double)cs.peltier_temperature_target, (double)cs.peltier_current_target,
		(double)cs.lid_current_filtered, (double)cs.lid_temperature_filtered, (double)cs.lid_temperature_target,
		(double)cs.hbridge_voltage_target, (double)cs.hbridge_duty_cycle, (unsigned long)cs.peltier_oscillation_period_ms,
		(double)cs.pid_p, (double)cs.pid_i, (double)cs.pid_d,
		(unsigned)adc_pelt_i, (unsigned)adc_lid_t, (unsigned)adc_pelt_t, (unsigned)adc_lid_i,
		(double)temp_coef.Kp, (double)temp_coef.Ti, (double)temp_coef.Td, (double)temp_coef.Tf, (double)temp_coef.Kb,
		(unsigned)provision_status, wifi ? 1u : 0u, buzzer ? 1u : 0u,
		(unsigned long)(HAL_GetTick() / 1000u), (unsigned)xPortGetFreeHeapSize());
	return SCPI_OK;
}

static int cmd_lcd(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	if (cap < LCD_ROWS * (LCD_COLS + 1)) {
		return SCPI_ERR_LINE_TOO_LONG;
	}

	char rows[LCD_ROWS][LCD_COLS];
	taskENTER_CRITICAL();
	memcpy(rows, front_buffer, sizeof(rows));
	taskEXIT_CRITICAL();

	size_t pos = 0;
	for (unsigned row = 0; row < LCD_ROWS; row++) {
		if (row) {
			out[pos++] = '|';
		}
		for (unsigned col = 0; col < LCD_COLS; col++) {
			unsigned char c = (unsigned char)rows[row][col];
			if (c == 0xDF) {
				out[pos++] = '*';          // degree glyph
			} else if (c < 0x20 || c > 0x7E) {
				out[pos++] = '?';
			} else {
				out[pos++] = (char)c;
			}
		}
	}
	out[pos] = '\0';
	return SCPI_OK;
}

static int cmd_inp_up(scpi_ctx_t*, const scpi_args_t* args, char*, size_t) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	encoder_counter -= 1;
	return SCPI_OK;
}

static int cmd_inp_down(scpi_ctx_t*, const scpi_args_t* args, char*, size_t) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	encoder_counter += 1;
	return SCPI_OK;
}

static int cmd_inp_press(scpi_ctx_t*, const scpi_args_t* args, char*, size_t) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	// was_rotary_pressed() debounces on (now - last_press) > 20 ms
	encoder_button_last_press_time = HAL_GetTick() - 25;
	encoder_button_state = 1;
	return SCPI_OK;
}

/* ---- command table ---- */

#define ALL_TRANSPORTS  (SCPI_TRANSPORT_ALL)
#define USB_LOCAL       (SCPI_TRANSPORT_USB | SCPI_TRANSPORT_LOCAL_WS)

static const scpi_cmd_t app_commands[] = {
	{ "*IDN?",      cmd_idn,       ALL_TRANSPORTS,     0 },
	{ "*RST",       cmd_rst,       ALL_TRANSPORTS,     0 },
	{ "STAT?",      cmd_stat,      ALL_TRANSPORTS,     0 },
	{ "PROT:STAR",  cmd_prot_star, ALL_TRANSPORTS,     0 },
	{ "PROT:STOP",  cmd_prot_stop, ALL_TRANSPORTS,     0 },
	{ "PROT:CYCL?", cmd_prot_cycl, ALL_TRANSPORTS,     0 },
	{ "PROT:DEF?",  cmd_prot_def,  ALL_TRANSPORTS,     0 },
	/* HW? is USB only: its reply (~350 chars) does not fit the 256-byte STM32<->ESP32 frame. */
	{ "HW?",        cmd_hw,        SCPI_TRANSPORT_USB, 0 },
	{ "LCD?",       cmd_lcd,       USB_LOCAL,          SCPI_FLAG_DEV_ONLY },
	{ "INP:UP",     cmd_inp_up,    USB_LOCAL,          SCPI_FLAG_DEV_ONLY },
	{ "INP:DOWN",   cmd_inp_down,  USB_LOCAL,          SCPI_FLAG_DEV_ONLY },
	{ "INP:PRESS",  cmd_inp_press, USB_LOCAL,          SCPI_FLAG_DEV_ONLY },
};

/* Hide commands outside their transport scope or dev-only ones on non-development devices. */
static int app_gate(const scpi_cmd_t* cmd, scpi_ctx_t* ctx) {
	unsigned transport = (unsigned)(uintptr_t)ctx->user;
	if ((cmd->scope & transport) == 0) {
		return 1;
	}
	if ((cmd->flags & SCPI_FLAG_DEV_ONLY) && provision_status != 1) {
		return 1;
	}
	return 0;
}

/* ---- entry points ---- */

void scpi_app_init() {
	scpi_mutex = xSemaphoreCreateMutexStatic(&scpi_mutex_storage);
	usb_tx_mutex = xSemaphoreCreateMutexStatic(&usb_tx_mutex_storage);
	apply_done = xSemaphoreCreateBinaryStatic(&apply_done_storage);

	scpi_init(&usb_ctx, app_commands, sizeof(app_commands) / sizeof(app_commands[0]), app_gate,
		(void*)(uintptr_t)SCPI_TRANSPORT_USB);
	scpi_init(&host_ctx, app_commands, sizeof(app_commands) / sizeof(app_commands[0]), app_gate,
		(void*)(uintptr_t)SCPI_TRANSPORT_LOCAL_WS);
}

static void usb_emit(const char* line, void*) {
	usb_tx_line(line);
}

void scpi_app_usb_feed(const uint8_t* data, size_t len) {
	if (len == 0) {
		return;
	}
	xSemaphoreTake(scpi_mutex, portMAX_DELAY);
	usb_ctx.user = (void*)(uintptr_t)SCPI_TRANSPORT_USB;
	scpi_feed(&usb_ctx, data, len, usb_emit, nullptr);
	xSemaphoreGive(scpi_mutex);

	do_reset_if_pending();
}

void scpi_app_host_pump(unsigned max_lines) {
	static char line[SCPI_LINE_MAX];

	for (unsigned i = 0; i < max_lines; i++) {
		uint8_t tag;
		if (!esp_io_host_poll(&tag, line, sizeof(line))) {
			break;   // queue empty
		}

		unsigned transport = 0;   // unknown tag: every command hidden → ERR 100
		if (tag == 0) {
			transport = SCPI_TRANSPORT_LOCAL_WS;
		} else if (tag == 1) {
			transport = SCPI_TRANSPORT_CLOUD;
		}

		xSemaphoreTake(scpi_mutex, portMAX_DELAY);
		host_ctx.user = (void*)(uintptr_t)transport;
		int has_reply = scpi_dispatch_line(&host_ctx, line);
		xSemaphoreGive(scpi_mutex);

		// host_ctx.out is only ever touched by this thread, so it is still valid here
		if (has_reply) {
			esp_io_host_response(tag, host_ctx.out);
		}

		do_reset_if_pending();
	}
}
