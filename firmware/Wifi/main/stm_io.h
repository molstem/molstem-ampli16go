#pragma once

#include <stdint.h>
#include <stdbool.h>

// Largest SLIP payload in either direction, opcode byte included
// (docs/serial-api.md, "STM32 <-> ESP32 link"). Must match the STM32.
#define SLIP_PAYLOAD_MAX 256

void stm_io_uart_task(void *arg);

// Handle one request payload (rx_data[0] is the opcode) and fill the reply
// payload. tx_data has room for SLIP_PAYLOAD_MAX bytes. Returns true when the
// SLIP loop must stop (device unprovisioned: the UART is handed over to the
// provisioning line protocol).
bool stm_io_process(const uint8_t* rx_data, uint16_t rx_len, uint8_t* tx_data, uint16_t* tx_len, bool is_retransmission);
