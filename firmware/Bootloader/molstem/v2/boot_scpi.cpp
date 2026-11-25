/*
 * SCPI-style host protocol for the bootloader.
 *
 * USB RX: the CDC receive callback (USB IRQ) only stores the packet pointer
 * and length in a mailbox and does NOT re-arm the OUT endpoint. usb_poll()
 * (foreground) copies the packet into a staging buffer, re-arms the endpoint
 * and feeds the bytes to the shared scpi_line parser. While a BOOT:DATA line
 * blocks in fwu_feed() (ESP32 erase / 16 KB block write) the OUT endpoint
 * simply NAKs, which is the host's back-pressure.
 *
 * USB TX: replies are queued in a 16-line ring. tx_pump() coalesces queued
 * lines into one <=256 B CDC transfer whenever the IN endpoint is idle. If the
 * ring is full when a reply must be queued, tx_pump() is spun for up to 500 ms
 * so a 16-deep host window never loses a reply.
 */

#include "boot_scpi.hpp"
#include "fwu.hpp"
#include "git-version.h"

#include <cstdio>
#include <cstring>

extern "C" {
	#include "stm32f4xx_hal.h"
	#include "usb_device.h"
	#include "usbd_cdc_if.h"
	#include "helpers/scpi_line.h"
}

extern USBD_HandleTypeDef hUsbDeviceFS;

namespace {

// ---------------------------------------------------------------- RX mailbox

uint8_t* volatile rx_mbox_buf = nullptr;
volatile uint32_t rx_mbox_len = 0;

constexpr uint32_t RX_STAGING_SIZE = 512;
uint8_t rx_staging[RX_STAGING_SIZE];

// BOOT:DATA payload: up to 512 firmware bytes per line (1024 hex chars). The
// request line lives in the parser context (SCPI_LINE_MAX = 1280, set in the
// project defines); the decoded bytes go through this static buffer.
constexpr size_t BOOT_DATA_MAX_BYTES = 512;
static_assert(SCPI_LINE_MAX >= 10 + 2 * BOOT_DATA_MAX_BYTES + 2, "SCPI_LINE_MAX too small for BOOT:DATA");
uint8_t boot_data_bin[BOOT_DATA_MAX_BYTES];

// ---------------------------------------------------------------- TX ring

constexpr unsigned TX_RING_SLOTS = 16;
constexpr unsigned TX_RING_LINE  = 96;    // longest reply (*IDN? / ERROR status) + NUL
constexpr unsigned TX_CHUNK_MAX  = 256;   // one CDC transfer
constexpr uint32_t TX_FULL_SPIN_MS = 500;

char     tx_ring[TX_RING_SLOTS][TX_RING_LINE];
unsigned tx_ring_head = 0;   // next slot to write
unsigned tx_ring_tail = 0;   // next slot to send
unsigned tx_ring_count = 0;  // queued lines
uint8_t  tx_chunk[TX_CHUNK_MAX];

inline unsigned ring_next(unsigned i) { return (i + 1) % TX_RING_SLOTS; }
inline bool ring_empty() { return tx_ring_count == 0; }
inline bool ring_full()  { return tx_ring_count == TX_RING_SLOTS; }

USBD_CDC_HandleTypeDef* cdc_handle() {
	return (USBD_CDC_HandleTypeDef*)hUsbDeviceFS.pClassData;
}

bool usb_configured() {
	return hUsbDeviceFS.dev_state == USBD_STATE_CONFIGURED && cdc_handle() != nullptr;
}

// ---------------------------------------------------------------- state

scpi_ctx_t scpi;
bool     got_command = false;
bool     rst_pending = false;
uint32_t rst_tick = 0;

// ---------------------------------------------------------------- commands

int cmd_idn(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	snprintf(out, cap, "molstem,thermocycler-bootloader,%08lX%08lX%08lX,%s",
	         (unsigned long)HAL_GetUIDw0(), (unsigned long)HAL_GetUIDw1(), (unsigned long)HAL_GetUIDw2(),
	         GIT_VERSION);
	return SCPI_OK;
}

int cmd_rst(scpi_ctx_t*, const scpi_args_t* args, char*, size_t) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	rst_tick = HAL_GetTick();
	rst_pending = true;
	return SCPI_OK;   // "OK"; main loop resets ~50 ms later, after tx_pump flushed it
}

int cmd_boot_data(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 1) {
		return SCPI_ERR_ARG_COUNT;
	}
	const char* hex = args->argv[0];
	size_t hex_len = strlen(hex);
	if (hex_len < 2 || hex_len > 2 * BOOT_DATA_MAX_BYTES || (hex_len & 1)) {
		return SCPI_ERR_BAD_HEX;
	}

	uint8_t* bin = boot_data_bin;
	int n = scpi_hex_decode(hex, bin, BOOT_DATA_MAX_BYTES);
	if (n < 0) {
		return SCPI_ERR_BAD_HEX;
	}

	const char* msg = nullptr;
	int rc = fwu_feed(bin, (uint32_t)n, &msg);   // may block for seconds
	if (rc != SCPI_OK) {
		if (msg) {
			snprintf(out, cap, "%s", msg);
		}
		return rc;
	}

	snprintf(out, cap, "OK %lu", (unsigned long)fwu_bytes_total());
	return SCPI_OK;
}

int cmd_boot_stat(scpi_ctx_t*, const scpi_args_t* args, char* out, size_t cap) {
	if (args->count != 0) {
		return SCPI_ERR_ARG_COUNT;
	}
	FwuState st = fwu_state();
	uint32_t bytes = fwu_bytes_total();
	uint32_t total = fwu_total_size();
	unsigned percent = (unsigned)(((uint64_t)bytes * 100u) / total);
	if (percent > 100) {
		percent = 100;
	}

	int n = snprintf(out, cap, "%s,%u,%lu", fwu_state_name(st), percent, (unsigned long)bytes);
	if (n < 0) {
		return SCPI_OK;
	}
	size_t pos = (size_t)n < cap ? (size_t)n : cap - 1;

	const char* msg = fwu_error();
	if (st == FwuState::ERROR && msg && pos + 1 < cap) {
		out[pos++] = ',';
		out[pos] = '\0';
		scpi_out_quoted(out, cap, &pos, msg);
	}
	return SCPI_OK;
}

const scpi_cmd_t command_table[] = {
	{ "*IDN?",      cmd_idn,       0, 0 },
	{ "*RST",       cmd_rst,       0, 0 },
	{ "BOOT:DATA",  cmd_boot_data, 0, 0 },
	{ "BOOT:STAT?", cmd_boot_stat, 0, 0 },
};

void emit_reply(const char* line, void*) {
	if (ring_full()) {
		// Never lose a reply of a pipelined window: wait for the IN endpoint.
		uint32_t t0 = HAL_GetTick();
		while (ring_full() && (HAL_GetTick() - t0) < TX_FULL_SPIN_MS) {
			boot_scpi::tx_pump();
		}
	}
	boot_scpi::queue_line(line);
}

} // namespace

// ---------------------------------------------------------------- ISR side

extern "C" void molstem_on_receive_data(uint8_t* Buf, uint32_t* pLen) {
	rx_mbox_len = *pLen;
	rx_mbox_buf = Buf;
}

// ---------------------------------------------------------------- API

namespace boot_scpi {

void init() {
	scpi_init(&scpi, command_table, sizeof(command_table) / sizeof(command_table[0]), nullptr, nullptr);
	tx_ring_head = tx_ring_tail = tx_ring_count = 0;
	got_command = false;
	rst_pending = false;
	rx_mbox_buf = nullptr;
}

void usb_poll() {
	uint8_t* buf = rx_mbox_buf;
	if (buf == nullptr) {
		return;
	}
	uint32_t len = rx_mbox_len;
	if (len > RX_STAGING_SIZE) {
		len = RX_STAGING_SIZE;   // cannot happen: FS bulk packets are 64 B
	}
	memcpy(rx_staging, buf, len);

	// Consume the mailbox before re-arming so a new packet can never be lost.
	rx_mbox_buf = nullptr;
	USBD_CDC_SetRxBuffer(&hUsbDeviceFS, buf);
	USBD_CDC_ReceivePacket(&hUsbDeviceFS);

	if (len == 0) {
		return;
	}
	if (scpi_feed(&scpi, rx_staging, len, emit_reply, nullptr) > 0) {
		got_command = true;
	}
}

bool queue_line(const char* line) {
	if (ring_full()) {
		return false;
	}
	char* slot = tx_ring[tx_ring_head];
	strncpy(slot, line, TX_RING_LINE - 1);
	slot[TX_RING_LINE - 1] = '\0';
	tx_ring_head = ring_next(tx_ring_head);
	tx_ring_count++;
	return true;
}

void tx_pump() {
	if (ring_empty()) {
		return;
	}
	if (!usb_configured()) {
		// Nobody is listening (cable unplugged / not enumerated): drop instead of
		// wedging the foreground behind a transfer that can never complete.
		tx_ring_tail = tx_ring_head;
		tx_ring_count = 0;
		return;
	}
	if (cdc_handle()->TxState != 0) {
		return;
	}

	// Coalesce as many whole lines as fit; keep one byte spare for the ZLP guard.
	size_t n = 0;
	while (!ring_empty()) {
		const char* line = tx_ring[tx_ring_tail];
		size_t l = strlen(line);
		if (n + l + 1 > TX_CHUNK_MAX - 1) {
			break;
		}
		memcpy(&tx_chunk[n], line, l);
		n += l;
		tx_chunk[n++] = '\n';
		tx_ring_tail = ring_next(tx_ring_tail);
		tx_ring_count--;
	}
	if (n == 0) {
		return;
	}

	// A transfer that is a multiple of the 64 B packet size would need a
	// zero-length packet to terminate; pad the last line with a space instead.
	if ((n % 64) == 0) {
		tx_chunk[n - 1] = ' ';
		tx_chunk[n++] = '\n';
	}

	CDC_Transmit_FS(tx_chunk, (uint16_t)n);
}

bool tx_idle() {
	if (!ring_empty()) {
		return false;
	}
	if (!usb_configured()) {
		return true;
	}
	return cdc_handle()->TxState == 0;
}

bool command_received() {
	return got_command;
}

bool reset_pending() {
	return rst_pending;
}

uint32_t reset_request_tick() {
	return rst_tick;
}

} // namespace boot_scpi
