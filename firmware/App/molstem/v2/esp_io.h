#pragma once

#include <cstddef>
#include <cstdint>

void esp_io_ping();
void esp_io_get_provision_status(uint8_t* provision_status);
void esp_io_reprovision();
void esp_io_get_settings(bool* buzzer, bool* wifi);
void esp_io_set_settings(bool buzzer, bool wifi);
void esp_io_get_calibration(float* Kp, float* Ti, float* Td, float* Tf, float* Kb);
void esp_io_reset_wifi_config();
void esp_io_get_wifi_status(char mode[13], char status[21]);
void esp_io_get_wifi_network_information(char ssid[21], char ip[21], int8_t* rssi);
void esp_io_broadcast_lcd_text(const char front_buffer[][20]);

/* Device serial ("MOLSTEM-…", ≤34 chars) as stored on the ESP32; empty string if none. */
void esp_io_get_serial(char out[35]);

/* Fetch one queued host request line (local /ws: tag 0, cloud: tag 1).
 * Returns false when nothing is queued. `line` is NUL-terminated, at most cap-1 chars. */
bool esp_io_host_poll(uint8_t* tag, char* line, size_t cap);

/* Send one reply line (≤254 chars, clamped) back to the tagged host socket. */
void esp_io_host_response(uint8_t tag, const char* line);
