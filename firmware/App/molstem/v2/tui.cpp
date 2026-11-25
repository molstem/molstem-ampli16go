extern "C" {
	#include "drivers/lcd.h"
	#include "drivers/led.h"
	#include "drivers/buzzer.h"
	#include "pcr.h"
	#include "control/temp_control_pid.h"
}

#include "control/control.hpp"
#include "helpers/helpers.hpp"

extern "C" {
	#include "stm32f4xx_hal_flash.h"
	#include "stm32f4xx_hal_flash_ex.h"
	extern volatile int32_t encoder_counter;
}

#include "git-version.h"
#include "renderer.h"
#include "esp_io.h"
#include "tui.h"

using namespace microtask;
using namespace std::chrono_literals;

#include <cmath>

void render();

enum device_mode {
	mode_ready,
	mode_in_operation,
	mode_modal,
};

enum ui_page {
	page_main,
	page_menu,
	page_settings,
	page_dev_settings,
	page_wifi_settings,
	page_wifi_status,
	page_wifi_network_information,
	page_define_protocol_intro_denaturing,
	page_define_protocol_cycles,
	page_define_protocol_denaturing,
	page_define_protocol_annealing,
	page_define_protocol_extension,
	page_define_protocol_final_extension,
	page_pid_tune
};

#define DEG_C_STR "\xDF" "C"
/* PROGRESS_* sentinels live in tui.h (shared with the serial API) */

struct ui_state_t {
	device_mode current_mode = mode_ready;
	ui_page current_page = page_main;
	uint8_t setup_selection;


	const char* volatile in_opreation_text;
	volatile uint16_t in_operation_current_cycle;
	volatile uint16_t in_operation_total_cycles;
	volatile unsigned in_operation_remaining_seconds;
	volatile bool in_operation_canceled;
	volatile bool in_operation_cancel_ui;
	volatile bool in_operation_completed;

	char modal_text[LCD_COLS+1];
	device_mode modal_prev_mode;
	const char* modal_buttons[2];
	microtask::ManualResumeAwaiter<int>* modal_awaiter = nullptr;

	char file_list[4][LCD_COLS+1];

	int file_list_head;
	bool file_list_scroll = true;
	int back_filesel = 0;
};

ui_state_t ui_state;
extern microtask::MicrotaskScheduler scheduler;

Task show_modal_for(const char* title, const char* text, Duration delay) {
	auto prev_mode = ui_state.current_mode;
	strncpy(ui_state.modal_text, text, sizeof(ui_state.modal_text));
	ui_state.current_mode = mode_modal;
	ui_state.modal_buttons[0] = ui_state.modal_buttons[1] = nullptr;
	co_await yield_for(delay);
	ui_state.current_mode = prev_mode;
}

// Helper to show modal and wait for button press - returns button index (0 or 1)
auto show_modal_options(const char* title, const char* text, const char* btn1_text, const char* btn2_text) {
	return microtask::yield_with_setup_cleanup<int>(
		[=](microtask::ManualResumeAwaiter<int>* awaiter) {
			// Set up the modal UI
			strncpy(ui_state.modal_text, text, sizeof(ui_state.modal_text));
			ui_state.current_mode = mode_modal;
			ui_state.modal_buttons[0] = btn1_text;
			ui_state.modal_buttons[1] = btn2_text;

			// Store awaiter pointer when suspending
			// At this point, the ReturnValueAwaiter lives in the caller's stack frame
			ui_state.modal_awaiter = awaiter;
		},
		[prev_mode = ui_state.current_mode](int result) {
			// Clean up after button press
			ui_state.modal_awaiter = nullptr;
			ui_state.current_mode = prev_mode;
		}
	);
}

void switch_to(ui_page page) {
	ui_state.current_page = page;
	do {
		encoder_counter = 0;
	} while (encoder_counter != 0);
}

void on_tui_load_protocol();
void on_tui_firmware_update();
void on_tui_in_operation();

Task ui_task() {
	led(false, false, false);
	
	ui_state.current_page = page_main;
    ui_state.current_mode = mode_ready;

    for(uint8_t i=0;i<2;++i){
    	buzzer_beep_state(true);
    	co_await yield_for(100ms);
    	buzzer_beep_state(false);
    	co_await yield_for(100ms);
    }
}

void tui_main()
{
	renderer_right(0, "idle");

	control_status_t control_status;

	control_get_status(&control_status);
	char temp[20];
	sprintf(temp, "%.0f" DEG_C_STR, control_status.lid_temperature_filtered);
	renderer_left(1,0, temp);
	sprintf(temp, "%.0f" DEG_C_STR, control_status.peltier_temperature_filtered);
	renderer_left(2,0, temp);


    if (was_rotary_pressed()) {
    	switch_to(page_menu);
    }
}

void tui_in_operation() {
	led(false, false, false);

	if (ui_state.in_operation_completed) {
		renderer_centered(2, "Protocol Completed");
	} else if (ui_state.in_operation_canceled) {
		renderer_centered(2, "Aborting protocol");
	} else if (ui_state.in_operation_cancel_ui) {
		renderer_centered(2, "Abort protocol?");

		editable_define_focus_group(2);
		renderer_cursor(3, 2);
		if (selectable_label("No")) {
			ui_state.in_operation_cancel_ui = false;
		}

		renderer_cursor(3, LCD_COLS - 3 - strlen("Yes"));
		if (selectable_label("Yes")) {
			ui_state.in_operation_cancel_ui = false;
			ui_state.in_operation_canceled = true;
		}
	} else {
		renderer_right(0, ui_state.in_opreation_text);

		control_status_t control_status;

		control_get_status(&control_status);
		char temp[20];
		sprintf(temp, "%.0f/%.0f" DEG_C_STR, control_status.lid_temperature_filtered, control_status.lid_temperature_target);
		renderer_left(1,0, temp);
		sprintf(temp, "%.0f", control_status.peltier_temperature_filtered);
		renderer_left(2,0, temp);
		if (control_status.peltier_temperature_target != TARGET_DISABLED) {
			sprintf(temp, "/%.0f", control_status.peltier_temperature_target);
			renderer_string(temp);
		}
		renderer_string(DEG_C_STR);

		if (ui_state.in_operation_total_cycles > 1) {
			renderer_right(1, "Cycles:");
			sprintf(temp, "%d/%d", ui_state.in_operation_current_cycle + 1, ui_state.in_operation_total_cycles);
			renderer_right(2, temp);
		}

		int total_time =
				operation_definition.cycles * (operation_definition.stages[stage_denaturing].time + operation_definition.stages[stage_annealing].time + operation_definition.stages[stage_extension].time)
				+ operation_definition.stages[stage_intro_denaturing].time + operation_definition.stages[stage_final_extension].time;

		renderer_left(3, 0, "");

		if (ui_state.in_operation_remaining_seconds == PROGRESS_HEATING_LID) {
			led(true, false, false);
			renderer_string("heating lid");
		} else if (ui_state.in_operation_remaining_seconds == PROGRESS_HEATING) {
			led(true, false, false);
			renderer_string("heating up");
		} else if (ui_state.in_operation_remaining_seconds == PROGRESS_COOLING) {
			led(false, false, true);
			renderer_string("cooling down");
		} else {
			unsigned m = ui_state.in_operation_remaining_seconds / 60;
			unsigned s = ui_state.in_operation_remaining_seconds % 60;

			if (m) {
				sprintf(temp, "%um %us", m, s);
			} else {
				sprintf(temp, "%us", s);
			}
			renderer_string(temp);
		}


		unsigned m = total_time / 60;
		unsigned s = total_time % 60;

		if (m) {
			sprintf(temp, "%um %us", m, s);
		} else {
			sprintf(temp, "%us", s);
		}

		renderer_right(3, temp);

		if (was_rotary_pressed()) {
			ui_state.in_operation_cancel_ui = true;
		}
	}
}

Task firmware_update_task() {
	co_await yield_reschedule();

	int button_pressed = co_await show_modal_options("Firmware Update", "Are you sure?", "Yes", "No");
	if (button_pressed == 0) {
		on_tui_firmware_update();
	}
}


extern unsigned wifi;
extern unsigned buzzer;
extern uint8_t provision_status;

void tui_menu()
{
	editable_define_focus_group(provision_status == 1 ? 4 : 3);

	renderer_cursor(0, 0);
	if (selectable_label("Back")) {
		switch_to(page_main);
	}
	renderer_cursor(1, 0);
	if (selectable_label("Define Bio Protocol")) {
		switch_to(page_define_protocol_intro_denaturing);
	}
	renderer_cursor(2, 0);
	if (selectable_label("Settings")) {
		switch_to(page_settings);
	}

	if (provision_status == 1) {
		renderer_cursor(3, 0);
		if (selectable_label("Dev Settings")) {
			switch_to(page_dev_settings);
		}
	}
}

static const char* off_on_options[] = { "Off", "On" };

void tui_settings()
{
	editable_define_focus_group(4);
	renderer_cursor(0, 0);
	if (selectable_label("Back")) {
		switch_to(page_menu);
	}
	renderer_cursor(1, 0);
	if (enum_label_values("Buzzer", off_on_options, 2, &buzzer)) {
		// Value toggled
		esp_io_set_settings(buzzer != 0, wifi != 0);
	}

	renderer_cursor(2, 0);
	if (selectable_label("WiFi")) {
		switch_to(page_wifi_settings);
	}
	renderer_cursor(3, 0);
	if (selectable_label("Firmware Update")) {
		scheduler.queue_task(firmware_update_task());
	}
}

void on_tui_pid_tune();

Task reprovision_task() {
	co_await yield_reschedule();

	int button_pressed = co_await show_modal_options("Re-provision Device", "Are you sure?", "Yes", "no");
	if (button_pressed == 0) {
		esp_io_reprovision();

		__enable_irq();
		NVIC_SystemReset();
	}
}

void tui_dev_settings()
{
	editable_define_focus_group(3);
	renderer_cursor(0, 0);
	if (selectable_label("Back")) {
		switch_to(page_menu);
	}
	renderer_cursor(1, 0);
	if (selectable_label("PID Tuning")) {
		on_tui_pid_tune();
	}
	renderer_cursor(2, 0);
	if (selectable_label("Re-provision")) {
		scheduler.queue_task(reprovision_task());
	}
	renderer_cursor(3, 0);
	renderer_string("S/N: 0123456789");
}

Task wifi_reset_configuration_task() {
	co_await yield_reschedule();

	int button_pressed = co_await show_modal_options("Reset WiFi Config", "Are you sure?", "No", "Yes");
	if (button_pressed == 1) {
		esp_io_reset_wifi_config();
	}
}

void tui_wifi_settings()
{
	editable_define_focus_group(4);
	renderer_cursor(0, 0);
	if (selectable_label("Back")) {
		switch_to(page_settings);
	}
	renderer_cursor(1, 0);
	if (enum_label_values("WiFi", off_on_options, 2, &wifi)) {
		// Value toggled
		esp_io_set_settings(buzzer != 0, wifi != 0);
	}
	renderer_cursor(2, 0);
	if (selectable_label("Reset WiFi Config")) {
		scheduler.queue_task(wifi_reset_configuration_task());
	}
	renderer_cursor(3, 0);
	if (selectable_label("Status")) {
		switch_to(page_wifi_status);
	}
}

char wifi_mode[13];
char wifi_status[21];
char wifi_ssid[21];
char wifi_ip[21];
int8_t wifi_rssi;

void network_status_periodical() {
	if (ui_state.current_page == page_wifi_status) {
		esp_io_get_wifi_status(wifi_mode, wifi_status);
	} else if (ui_state.current_page == page_wifi_network_information) {
		esp_io_get_wifi_network_information(wifi_ssid, wifi_ip, &wifi_rssi);
	}
}

void tui_wifi_status()
{
	editable_define_focus_group(2);
	renderer_cursor(0, 0);
	if (selectable_label("Back")) {
		switch_to(page_wifi_settings);
	}
	renderer_cursor(1, 0);
	if (selectable_label("Network Information")) {
		switch_to(page_wifi_network_information);
	}

	renderer_cursor(2, 0);
	renderer_string("mode: ");
	renderer_string(wifi_mode);

	renderer_cursor(3, 0);
	renderer_string(wifi_status);
}

void tui_wifi_network_information()
{
	editable_define_focus_group(1);
	renderer_cursor(0, 0);
	if (selectable_label("Back")) {
		switch_to(page_wifi_status);
	}
	renderer_cursor(1, 0);
	renderer_string("SSID / IP:");

	renderer_cursor(2, 0);
	renderer_string(wifi_ssid);

	renderer_cursor(3, 0);
	renderer_string(wifi_ip);

	if (wifi_rssi != 0) {
		char rssi_str[8];
		snprintf(rssi_str, sizeof(rssi_str), "%ddB", wifi_rssi);
		renderer_right(1, rssi_str);
	}
}


void tui_define_protocol() {
	int stage_number = ui_state.current_page - page_define_protocol_intro_denaturing;
	bool cycles_page = stage_number == 1;

	if (stage_number > 1) {
		stage_number --;
	}

	if (cycles_page) {
		renderer_left(0, 0, "Protocol Cycles");
		editable_define_focus_group(3);
		renderer_cursor(1, 2);
		editable_value("", &operation_definition.cycles, operation_definition.cycles == 1 ? " Cycle": " Cycles", operation_definition.min_cycles, operation_definition.max_cycles, 1);
	} else {
		renderer_left(0, 0, stage_name[stage_number]);
		editable_define_focus_group(4);
		renderer_cursor(1, 2);
		editable_value("", &operation_definition.stages[stage_number].peltier, DEG_C_STR, operation_definition.stages[stage_number].min_peltier, operation_definition.stages[stage_number].max_peltier, 1);
		renderer_cursor(2, 2);
		editable_value("", &operation_definition.stages[stage_number].time, "s", operation_definition.stages[stage_number].min_time, operation_definition.stages[stage_number].max_time, operation_definition.stages[stage_number].delta_time, true);
	}

	renderer_cursor(3, 2);
	if (selectable_label("Back")) {
		if (stage_number == 0) {
			switch_to(page_menu);
		} else {
			switch_to(ui_page(ui_state.current_page - 1));
		}
	}
	renderer_cursor(3, 12);
	if (selectable_label(ui_state.current_page == page_define_protocol_final_extension ? "Start" : "Next")) {
		if (ui_state.current_page == page_define_protocol_final_extension) {
			on_tui_in_operation();
		} else {
			switch_to(ui_page(ui_state.current_page + 1));
		}
	}
}

extern temp_pid_coef_t temp_coef;

static float pid_tune_target = 50;

Task pid_tune_task() {
	co_await yield_reschedule();

	control_status_t control_status;

	control_set_target_lid(105);

	{
		for(;;) {
			control_set_target_peltier(pid_tune_target);
			control_get_status(&control_status);
			if (ui_state.current_page != page_pid_tune) {
				goto cleanup;
			}
			co_await yield_for(100ms);
		}
	}

cleanup:
	control_set_target_peltier(TARGET_DISABLED);
	control_set_target_lid(TARGET_DISABLED);
}

void on_tui_pid_tune() {
	switch_to(page_pid_tune);
	scheduler.queue_task(pid_tune_task());
}

void tui_pid_tune() {
	bool auto_tune_mode = (temp_coef.Ti == 1000000.0f);

	editable_define_focus_group(8);
	renderer_cursor(0, 0);
	editable_value("Kp ", &temp_coef.Kp, "", 0.01, 10, auto_tune_mode ? 0.01f : 0.1f, false, "%0.3f");
	renderer_cursor(1, 0);
	editable_value("Ti ", &temp_coef.Ti, "", 0.01, 10, 0.1f, false, "%0.3f");
	renderer_cursor(2, 0);
	editable_value("Td ", &temp_coef.Td, "", 0.01, 10, 0.1f, false, "%0.3f");
	renderer_cursor(3, 0);
	editable_value("Tf ", &temp_coef.Tf, "", 0.01, 10, 0.01f, false, "%0.3f");
	renderer_cursor(0, 10);
	editable_value("Kb ", &temp_coef.Kb, "", 0.01, 10, 0.1f, false, "%0.3f");

	renderer_cursor(1, 10);
	char temp[10];
	control_status_t control_status;
	control_get_status(&control_status);
	float period = control_status.peltier_oscillation_period_ms / 1000.0f;
	snprintf(temp, sizeof(temp), "P%.3f", period);
	if (selectable_label(auto_tune_mode ? temp : "Auto")) {
		if (auto_tune_mode) {
			// Ku = current Kp (critical gain), Tu = oscillation period
			float Ku = temp_coef.Kp;
			float Tu = period;

			if (Tu > 0.1f) {  // Valid period detected
				// Ziegler-Nichols PID tuning
				temp_coef.Kp = 0.6f * Ku;
				temp_coef.Ti = Tu / 2.0f;
				temp_coef.Td = Tu / 8.0f;
				temp_coef.Tf = temp_coef.Td / 10.0f;
			}
		} else {
			temp_coef.Kp = 2.90;
			temp_coef.Ti = 1000000.0f; 	// effectively disable I
			temp_coef.Td = 0;			// disable D
		}
	}

	renderer_cursor(2, 10);
	editable_value("TGT ", &pid_tune_target, DEG_C_STR, 20, 100, 1);

	renderer_cursor(3, 10);
	if (selectable_label("Back")) {
		switch_to(page_dev_settings);
	}
}

#define APP_SIZE (3 * 128 * 1024)
#define APP_BASE (0x8020000)
#define SINGATURE_SIZE (64)

void on_tui_firmware_update() {
	__disable_irq();
	HAL_FLASH_Unlock();
	// Clear up signature to force a firmware Update
	for (unsigned i = 0; i < 64; i+= 4) {
		while (HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, APP_BASE + APP_SIZE - SINGATURE_SIZE + i, 0) != HAL_OK) {
			;
		}
	}
	HAL_FLASH_Lock();
	__enable_irq();
	NVIC_SystemReset();
}

Task in_operation_phase(const char* name, float target, unsigned seconds, unsigned cycle, unsigned cycles) {
	ui_state.in_opreation_text = name;
	ui_state.in_operation_current_cycle = cycle;
	ui_state.in_operation_total_cycles = cycles;
	control_set_target_peltier(target);

	{
		control_status_t control_status;
		// reach target temperature
		for(;;) {
			if (ui_state.in_operation_canceled) {
				goto cleanup;
			}

			control_get_status(&control_status);
			ui_state.in_operation_remaining_seconds = control_status.peltier_temperature_filtered >= control_status.peltier_temperature_target ? PROGRESS_COOLING : PROGRESS_HEATING;
			if (fabs(control_status.peltier_temperature_filtered - target) < 0.2f) {
				break;
			}

			co_await yield_for(100ms);
		}

		auto remaining_seconds = seconds;
		do {
			if (ui_state.in_operation_canceled) {
				goto cleanup;
			}

			ui_state.in_operation_remaining_seconds = remaining_seconds;

			co_await yield_for(1000ms);
		} while(--remaining_seconds > 0);
	}

	cleanup:

		(void)0;
}

Task in_opreation_task() {
	co_await yield_reschedule();

	{
		ui_state.in_operation_cancel_ui = false;
		ui_state.in_operation_canceled = false;
		ui_state.in_operation_completed = false;

		ui_state.in_opreation_text = "Lid pre-heating";
		ui_state.in_operation_current_cycle = 0;
		ui_state.in_operation_total_cycles = 0;
		ui_state.in_operation_remaining_seconds = PROGRESS_HEATING_LID;
		control_set_target_lid(105);

		control_status_t control_status;

		do {
			co_await yield_for(1000ms);
			control_get_status(&control_status);
			if (ui_state.in_operation_canceled) goto cleanup;
		} while(fabs(control_status.lid_temperature_filtered  - 105) > 0.2f);
	}


	{
		int stage = 0;
		co_await in_operation_phase(stage_name[stage], operation_definition.stages[stage].peltier, operation_definition.stages[stage].time, 0, 0);
		if (ui_state.in_operation_canceled) goto cleanup;
		for (int cycle = 0; cycle < operation_definition.cycles; cycle++) {
			for(stage = 1; stage < 4; stage++) {
				co_await in_operation_phase(stage_name[stage], operation_definition.stages[stage].peltier, operation_definition.stages[stage].time, cycle, operation_definition.cycles);
				if (ui_state.in_operation_canceled) goto cleanup;
			}
		}
		stage = 4;
		co_await in_operation_phase(stage_name[stage], operation_definition.stages[stage].peltier, operation_definition.stages[stage].time, 0, 0);
		if (ui_state.in_operation_canceled) goto cleanup;
	}

	ui_state.in_operation_completed = true;
	buzzer_beep_state(true);
	co_await yield_for(100ms);
	buzzer_beep_state(false);
	co_await yield_for(100ms);
	buzzer_beep_state(true);
	co_await yield_for(100ms);
	buzzer_beep_state(false);
	co_await yield_for(100ms);
	buzzer_beep_state(true);
	co_await yield_for(100ms);
	buzzer_beep_state(false);
	co_await yield_for(3000ms);

	cleanup:

	control_set_target_lid(TARGET_DISABLED);
	control_set_target_peltier(TARGET_DISABLED);

	ui_state.current_mode = mode_ready;
}

void on_tui_in_operation() {
	// Run metadata for the serial API (PROT:STAR fills in name/comment afterwards)
	taskENTER_CRITICAL();
	run_meta.name[0] = '\0';
	run_meta.comment[0] = '\0';
	run_meta.start_tick = HAL_GetTick();
	taskEXIT_CRITICAL();

	ui_state.in_opreation_text = "starting up";
	switch_to(page_main);
	ui_state.current_mode = mode_in_operation;
	scheduler.queue_task(in_opreation_task());
}

void tui_modal() {
	renderer_centered(2, ui_state.modal_text);

	auto btn_count = (ui_state.modal_buttons[0] != 0) + (ui_state.modal_buttons[1] != 0);
	if (btn_count) {
		editable_define_focus_group(btn_count);
		renderer_cursor(3, 2);
		for (unsigned i = 0; i < 2; i++) {
			if (ui_state.modal_buttons[i]) {
				if (selectable_label(ui_state.modal_buttons[i])) {
					// Button was pressed - resume the suspended task
					if (ui_state.modal_awaiter && ui_state.modal_awaiter->is_suspended()) {
						ui_state.modal_awaiter->resume(i);
					}
				}
				renderer_string(" ");
			}
		}
	}
}

void tui_render() {
	renderer_clear();

	switch (ui_state.current_mode) {
		case mode_ready: {
			switch(ui_state.current_page) {
				case page_main: led(false, false, false); tui_main(); break;
				case page_menu: led(false, false, false); tui_menu(); break;

				case page_settings: tui_settings(); break;
				case page_dev_settings: tui_dev_settings(); break;
				case page_wifi_settings: tui_wifi_settings(); break;
				case page_wifi_status: tui_wifi_status(); break;
				case page_wifi_network_information: tui_wifi_network_information(); break;
				case page_pid_tune: tui_pid_tune(); break;

				case page_define_protocol_intro_denaturing:
				case page_define_protocol_cycles:
				case page_define_protocol_denaturing:
				case page_define_protocol_annealing:
				case page_define_protocol_extension:
				case page_define_protocol_final_extension:
					tui_define_protocol();
					break;
			}
		} break;
		case mode_in_operation: tui_in_operation(); break;
		case mode_modal: tui_modal(); break;
	}

	renderer_display();
}

void tui_render_provision() {
	display_init();

	renderer_clear();

	renderer_centered(3, "Provisioning...");

	renderer_display();
}

/* ---- serial API accessors (scpi_app.cpp) ---- */

void tui_get_run_snapshot(tui_run_snapshot_t* snapshot) {
	taskENTER_CRITICAL();
	snapshot->ready = ui_state.current_mode == mode_ready;
	snapshot->running = ui_state.current_mode == mode_in_operation;
	snapshot->pid_tune = ui_state.current_page == page_pid_tune;
	snapshot->phase_text = ui_state.in_opreation_text;
	snapshot->current_cycle = ui_state.in_operation_current_cycle;
	snapshot->total_cycles = ui_state.in_operation_total_cycles;
	snapshot->remaining_seconds = ui_state.in_operation_remaining_seconds;
	snapshot->canceled = ui_state.in_operation_canceled;
	snapshot->cancel_ui = ui_state.in_operation_cancel_ui;
	snapshot->completed = ui_state.in_operation_completed;
	snapshot->total_time_s =
			operation_definition.cycles * (operation_definition.stages[stage_denaturing].time + operation_definition.stages[stage_annealing].time + operation_definition.stages[stage_extension].time)
			+ operation_definition.stages[stage_intro_denaturing].time + operation_definition.stages[stage_final_extension].time;
	taskEXIT_CRITICAL();
}

bool tui_can_start_run() {
	return ui_state.current_mode == mode_ready && ui_state.current_page != page_pid_tune;
}

bool tui_request_abort() {
	bool accepted = false;
	taskENTER_CRITICAL();
	if (ui_state.current_mode == mode_in_operation && !ui_state.in_operation_canceled && !ui_state.in_operation_completed) {
		ui_state.in_operation_canceled = true;
		ui_state.in_operation_cancel_ui = false;
		accepted = true;
	}
	taskEXIT_CRITICAL();
	return accepted;
}
