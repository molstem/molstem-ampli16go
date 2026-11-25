#pragma once

#include <cstdint>

/* Maximum SLIP frame payload (opcode + data) in either direction. */
#define ESP_PAYLOAD_MAX 256

extern uint8_t esp_tx_buffer[ESP_PAYLOAD_MAX + 4];
extern uint16_t esp_tx_len;

extern uint8_t esp_rx_buffer[ESP_PAYLOAD_MAX + 4];
extern uint16_t esp_rx_len;

void esp_send_command();
