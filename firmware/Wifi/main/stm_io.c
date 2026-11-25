#include "stm_io.h"
#include "config.h"
#include "helpers.h"
#include "nvs_config.h"
#include "wifi.h"
#include "provisioning.h"
#include "ws_bridge.h"
#include "host_queue.h"
#include <assert.h>
#include <string.h>
#include <stdbool.h>
#include <stdio.h>
#include "esp_log.h"

static const char *STM_TAG = "stm_io";

static char s_lcd_text[4][20];

// Opcodes are shared with firmware/App/molstem/v2/esp_io.cpp and documented in
// docs/serial-api.md ("STM32 <-> ESP32 link"). The STM32 is always the
// initiator; every request gets exactly one reply.
enum ESP_OPCODES {
	OPCODE_PING = 0x00,

	OPCODE_GET_SETTINGS = 0x01,
	OPCODE_SET_SETTINGS = 0x02,
	OPCODE_GET_CALIBRATION = 0x03,
	OPCODE_GET_PROVISION_STATUS = 0x04,
	OPCODE_REPROVISION = 0x05,

	OPCODE_WIFI_RESET_CONFIG = 0x06,
	OPCODE_WIFI_GET_STATUS = 0x07,
	OPCODE_WIFI_GET_NETWORK_INFORMATION = 0x08,

	// 0x09 PCR_STATUS and 0x0A PCR_HARDWARE_MONITOR are retired: hosts poll
	// HW? / PROT:CYCL? through the SCPI line protocol instead.

	OPCODE_BROADCAST_LCD_TEXT0 = 0x0B,
	OPCODE_BROADCAST_LCD_TEXT1 = 0x0C,

	OPCODE_GET_SERIAL = 0x0D,
	OPCODE_HOST_POLL = 0x0E,
	OPCODE_HOST_RESPONSE = 0x0F,
};

enum STM_OPCODES {
	OPCODE_PONG = 0x80,
	OPCODE_ERROR = 0x81,
	OPCODE_SETTING_DATA = 0x82,
	OPCODE_CALIBRATION_DATA = 0x83,
	OPCODE_WIFI_STATUS_DATA = 0x84,
	OPCODE_WIFI_NETWORK_INFORMATION_DATA = 0x85,
	OPCODE_PROVISION_DATA = 0x86,
	OPCODE_SERIAL_DATA = 0x87,
	OPCODE_HOST_LINE = 0x88,
};

// Last HOST_POLL reply, replayed verbatim when the STM32 retransmits the same
// command (its reply got lost) so that no queued line is dropped or doubled.
static uint8_t s_poll_reply[SLIP_PAYLOAD_MAX];
static uint16_t s_poll_reply_len = 0;

static void reply_pong(uint8_t* tx_data, uint16_t* tx_len) {
	tx_data[0] = OPCODE_PONG;
	*tx_len = 1;
}

static bool is_development(void) {
	return s_prov_state.prov_mode == PROV_MODE_DEVELOPMENT;
}

bool stm_io_process(const uint8_t* rx_data, uint16_t rx_len, uint8_t* tx_data, uint16_t* tx_len, bool is_retransmission) {
	assert(rx_len >= 1);
	uint8_t opcode = rx_data[0];

	switch (opcode) {
	case OPCODE_PING:
		reply_pong(tx_data, tx_len);
		break;

    case OPCODE_GET_PROVISION_STATUS:
		tx_data[0] = OPCODE_PROVISION_DATA;
		tx_data[1] = (uint8_t)s_prov_state.prov_mode;
		*tx_len = 2;
        if (s_prov_state.prov_mode == PROV_MODE_UNPROVISIONED) {
            return true; // stop serial loop after sending answer
        }
		break;

    case OPCODE_REPROVISION:
        if (!is_retransmission) {
            // ESP_LOGI(STM_TAG, "Reprovisioning requested, resetting provisioning state");
            reprovision();
        }
        reply_pong(tx_data, tx_len);
        break;

	case OPCODE_GET_SETTINGS:
		tx_data[0] = OPCODE_SETTING_DATA;
		tx_data[1] = 0;
		if (s_setting_buzzer) tx_data[1] |= 1;
		if (s_setting_wifi) tx_data[1] |= 2;
		*tx_len = 2;
		break;

	case OPCODE_SET_SETTINGS: {
		assert(rx_len == 2);
		if (!is_retransmission) {
			bool new_buzzer = rx_data[1] & 1;
			bool new_wifi = rx_data[1] & 2;
			bool wifi_changed = (new_wifi != s_setting_wifi);
			s_setting_buzzer = new_buzzer;
			s_setting_wifi = new_wifi;
			nvs_save_settings();
			if (wifi_changed) {
				wifi_set_enabled(new_wifi);
			}
		}
		reply_pong(tx_data, tx_len);
		break;
	}

	case OPCODE_GET_CALIBRATION:
		tx_data[0] = OPCODE_CALIBRATION_DATA;
		memcpy(&tx_data[1 + 0*4], &s_prov_state.cal_kp, sizeof(float));
		memcpy(&tx_data[1 + 1*4], &s_prov_state.cal_ti, sizeof(float));
		memcpy(&tx_data[1 + 2*4], &s_prov_state.cal_td, sizeof(float));
		memcpy(&tx_data[1 + 3*4], &s_prov_state.cal_tf, sizeof(float));
		memcpy(&tx_data[1 + 4*4], &s_prov_state.cal_kb, sizeof(float));
		*tx_len = 1 + 5 * 4;
		break;

	case OPCODE_WIFI_RESET_CONFIG:
		if (!is_retransmission) {
			ESP_LOGI(STM_TAG, "WiFi reset requested, returning to config mode");
			wifi_reset_to_config_mode();
		}
		reply_pong(tx_data, tx_len);
		break;

        case OPCODE_WIFI_GET_STATUS: {
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wformat-truncation"
		tx_data[0] = OPCODE_WIFI_STATUS_DATA;
		char mode[13] = {0};
		char status[21] = {0};

		if (!s_setting_wifi) {
			safe_strcpy(mode, "disabled", sizeof(mode));
			// status left empty
		} else if (!s_setup_committed) {
			safe_strcpy(mode, "unconfigured", sizeof(mode));
			char ap_ssid[32];
			wifi_get_ap_ssid(ap_ssid, sizeof(ap_ssid));
			snprintf(status, sizeof(status), "Join %s", ap_ssid);
		} else if (strcmp(s_setup_mode, "local") == 0) {
			safe_strcpy(mode, "local", sizeof(mode));
			snprintf(status, sizeof(status), "Visit %s", s_sta_ip);
		} else {
			// Cloud mode
			safe_strcpy(mode, "cloud", sizeof(mode));
			if (s_cloud_enrollment_id[0] != '\0') {
				snprintf(status, sizeof(status), "Enroll %s", s_cloud_enrollment_id);
			} else if (s_cloud_enrolled) {
				safe_strcpy(status, "app.molstem.com", sizeof(status));
			} else {
				safe_strcpy(status, "See app.molstem.com", sizeof(status));
			}
		}

		memcpy(&tx_data[1], mode, 13);
		memcpy(&tx_data[1 + 13], status, 21);
		*tx_len = 1 + 13 + 21;
		break;
#pragma GCC diagnostic pop
	}

	case OPCODE_WIFI_GET_NETWORK_INFORMATION: {
		tx_data[0] = OPCODE_WIFI_NETWORK_INFORMATION_DATA;
		char ssid[21] = {0};
		char ip[21] = {0};

		if (!s_setting_wifi) {
			safe_strcpy(ssid, "disabled", sizeof(ssid));
		} else if (!s_setup_committed) {
			wifi_get_ap_ssid(ssid, sizeof(ssid));
			safe_strcpy(ip, "192.168.4.1", sizeof(ip));
		} else {
			safe_strcpy(ssid, s_wifi_ssid, sizeof(ssid));
			safe_strcpy(ip, s_sta_ip, sizeof(ip));
		}

		int8_t rssi = 0;
		if (s_setting_wifi && s_setup_committed && s_wifi_connected) {
			wifi_ap_record_t ap_info;
			if (esp_wifi_sta_get_ap_info(&ap_info) == ESP_OK) {
				rssi = ap_info.rssi;
			}
		}

		memcpy(&tx_data[1], ssid, 21);
		memcpy(&tx_data[1 + 21], ip, 21);
		tx_data[1 + 21 + 21] = (uint8_t)rssi;
		*tx_len = 1 + 21 + 21 + 1;
		break;
	}

	case OPCODE_GET_SERIAL: {
		// ASCII serial, no terminator; empty until a device key exists.
		tx_data[0] = OPCODE_SERIAL_DATA;
		size_t n = 0;
		if (s_prov_state.identity_generated) {
			n = strnlen(s_device_serial, sizeof(s_device_serial));
			if (n > SLIP_PAYLOAD_MAX - 1) {
				n = SLIP_PAYLOAD_MAX - 1;
			}
			memcpy(&tx_data[1], s_device_serial, n);
		}
		*tx_len = (uint16_t)(1 + n);
		break;
	}

	case OPCODE_HOST_POLL: {
		if (is_retransmission && s_poll_reply_len > 0) {
			// Our previous reply was lost in transit: replay it instead of
			// consuming the next queued line.
			memcpy(tx_data, s_poll_reply, s_poll_reply_len);
			*tx_len = s_poll_reply_len;
			break;
		}

		uint8_t tag;
		size_t line_len;
		if (host_queue_pop(&tag, (char *)&tx_data[2], &line_len)) {
			tx_data[0] = OPCODE_HOST_LINE;
			tx_data[1] = tag;
			*tx_len = (uint16_t)(2 + line_len);
		} else {
			reply_pong(tx_data, tx_len);
		}

		memcpy(s_poll_reply, tx_data, *tx_len);
		s_poll_reply_len = *tx_len;
		break;
	}

	case OPCODE_HOST_RESPONSE: {
		// [tag:u8][reply line, no terminator]. A retransmitted frame was
		// already forwarded, so only PONG it again.
		if (!is_retransmission && rx_len >= 2) {
			host_reply(rx_data[1], (const char *)&rx_data[2], rx_len - 2);
		}
		reply_pong(tx_data, tx_len);
		break;
	}

	case OPCODE_BROADCAST_LCD_TEXT0: {
		if (!is_retransmission && is_development() && rx_len >= 1 + 40) {
			memcpy(s_lcd_text[0], &rx_data[1], 20);
			memcpy(s_lcd_text[1], &rx_data[1 + 20], 20);
		}
		reply_pong(tx_data, tx_len);
		break;
	}

	case OPCODE_BROADCAST_LCD_TEXT1: {
		// The LCD mirror and the virtual rotary/button input only exist on
		// development-provisioned devices (/screen and /screen-ws are not
		// registered otherwise) and are never sent to the cloud socket.
		int8_t rotary_adj = 0;
		uint8_t button_pressed = 0;

		if (is_development()) {
			if (!is_retransmission && rx_len >= 1 + 40) {
				memcpy(s_lcd_text[2], &rx_data[1], 20);
				memcpy(s_lcd_text[3], &rx_data[1 + 20], 20);

				// Encode as UTF-8 and send full screen to /screen-ws
				// Bytes >= 0x80 are encoded as their Unicode codepoint in UTF-8
				char buf[164]; // worst case: 80 * 2-byte UTF-8 + 3 newlines
				int pos = 0;
				for (int row = 0; row < 4; row++) {
					if (row > 0) buf[pos++] = '\n';
					for (int col = 0; col < 20; col++) {
						uint8_t c = (uint8_t)s_lcd_text[row][col];
						if (c >= 0x80) {
							// 2-byte UTF-8: preserves codepoint (e.g. 0xDF -> U+00DF)
							buf[pos++] = (char)(0xC0 | (c >> 6));
							buf[pos++] = (char)(0x80 | (c & 0x3F));
						} else if (c >= 0x20) {
							buf[pos++] = (char)c;
						} else {
							buf[pos++] = ' ';
						}
					}
				}
				ws_send_screen_text(buf, pos);
			}

			// Reply with accumulated input from /screen-ws
			ws_screen_consume_input(&rotary_adj, &button_pressed);
		}

		tx_data[0] = OPCODE_PONG;
		tx_data[1] = (uint8_t)rotary_adj;
		tx_data[2] = button_pressed;
		*tx_len = 3;
		break;
	}

	default:
		tx_data[0] = OPCODE_ERROR;
		*tx_len = 1;
		break;
	}

    return false;
}
