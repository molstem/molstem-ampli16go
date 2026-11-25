#pragma once

/*
 * SCPI-style serial API of the thermocycler application (docs/serial-api.md).
 *
 * Requests arrive over USB CDC (uart_bridge thread) and, via the ESP32 host
 * queue, from the local /ws client and the cloud socket (ESP tick thread).
 * All three share one command table and one dispatch mutex.
 */

#include <cstddef>
#include <cstdint>

/* Transport bits (scpi_cmd_t::scope mask, and the value carried in ctx->user). */
enum {
	SCPI_TRANSPORT_USB      = 1u << 0,
	SCPI_TRANSPORT_LOCAL_WS = 1u << 1,
	SCPI_TRANSPORT_CLOUD    = 1u << 2,
	SCPI_TRANSPORT_ALL      = SCPI_TRANSPORT_USB | SCPI_TRANSPORT_LOCAL_WS | SCPI_TRANSPORT_CLOUD,
};

/* scpi_cmd_t::flags */
enum {
	SCPI_FLAG_DEV_ONLY = 1u << 0,   /* only when provisioned in development mode */
};

/* Create the RTOS objects (static). Call before the kernel starts. */
void scpi_app_init();

/* Feed raw USB CDC bytes (uart_bridge thread). Replies are written with usb_tx_line(). */
void scpi_app_usb_feed(const uint8_t* data, size_t len);

/* Drain up to `max_lines` queued host lines from the ESP32 and answer them (ESP tick thread). */
void scpi_app_host_pump(unsigned max_lines);

/* Cache the device serial reported by the ESP32 for *IDN? (empty → STM32 UID fallback). */
void scpi_app_set_serial(const char* serial);

/* Write one reply line to USB CDC (appends "\n"; never blocks for more than ~100 ms). */
void usb_tx_line(const char* line);
