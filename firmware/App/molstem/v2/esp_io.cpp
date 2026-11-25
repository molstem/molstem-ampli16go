#include <cassert>
#include <cstring>

#include "esp_io.h"
#include "esp_serial.h"

extern "C" {
	#include "cmsis_os2.h"
}

extern osMutexId_t esp_ioHandle;

// STM32 -> ESP32 (see docs/serial-api.md, "STM32 <-> ESP32 link")
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

	// 0x09 PCR_STATUS and 0x0A PCR_HARDWARE_MONITOR are retired
	OPCODE_BROADCAST_LCD_TEXT0 = 0x0B,
	OPCODE_BROADCAST_LCD_TEXT1 = 0x0C,

	OPCODE_GET_SERIAL = 0x0D,
	OPCODE_HOST_POLL = 0x0E,
	OPCODE_HOST_RESPONSE = 0x0F,
};

// ESP32 -> STM32 replies
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

void esp_io_ping() {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_PING;
	esp_tx_len = 1;
	esp_send_command();
	assert(esp_rx_len == 1 && esp_rx_buffer[0] == OPCODE_PONG);
	osMutexRelease(esp_ioHandle);
}

void esp_io_reprovision() {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_REPROVISION;
	esp_tx_len = 1;
	esp_send_command();
	assert(esp_rx_len == 1 && esp_rx_buffer[0] == OPCODE_PONG);
	osMutexRelease(esp_ioHandle);
}

void esp_io_get_provision_status(uint8_t* provision_status) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_GET_PROVISION_STATUS;
	esp_tx_len = 1;

	esp_send_command();

	assert(esp_rx_len == 2 && esp_rx_buffer[0] == OPCODE_PROVISION_DATA);

	*provision_status = esp_rx_buffer[1];

	osMutexRelease(esp_ioHandle);
}

void esp_io_get_settings(bool* buzzer, bool* wifi) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_GET_SETTINGS;
	esp_tx_len = 1;

	esp_send_command();

	assert(esp_rx_len == 2 && esp_rx_buffer[0] == OPCODE_SETTING_DATA);

	*buzzer = esp_rx_buffer[1] & 1;
	*wifi = esp_rx_buffer[1] & 2;
	osMutexRelease(esp_ioHandle);
}

void esp_io_set_settings(bool buzzer, bool wifi) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_SET_SETTINGS;
	esp_tx_buffer[1] = 0;
	if (buzzer) esp_tx_buffer[1] |= 1;
	if (wifi) esp_tx_buffer[1] |= 2;

	esp_tx_len = 2;

	esp_send_command();

	assert(esp_rx_len == 1 && esp_rx_buffer[0] == OPCODE_PONG);
	osMutexRelease(esp_ioHandle);
}

void esp_io_get_calibration(float* Kp, float* Ti, float* Td, float* Tf, float* Kb) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_GET_CALIBRATION;
	esp_tx_len = 1;

	esp_send_command();

	assert(esp_rx_len == (1 + 5 * 4)  && esp_rx_buffer[0] == OPCODE_CALIBRATION_DATA);

	memcpy(Kp, &esp_rx_buffer[1 + 0*4], sizeof(*Kp));
	memcpy(Ti, &esp_rx_buffer[1 + 1*4], sizeof(*Ti));
	memcpy(Td, &esp_rx_buffer[1 + 2*4], sizeof(*Td));
	memcpy(Tf, &esp_rx_buffer[1 + 3*4], sizeof(*Tf));
	memcpy(Kb, &esp_rx_buffer[1 + 4*4], sizeof(*Kb));
	osMutexRelease(esp_ioHandle);
}


void esp_io_reset_wifi_config() {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_WIFI_RESET_CONFIG;
	esp_tx_len = 1;

	esp_send_command();

	assert(esp_rx_len == 1 && esp_rx_buffer[0] == OPCODE_PONG);
	osMutexRelease(esp_ioHandle);
}

void esp_io_get_wifi_status(char mode[13], char status[21]) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_WIFI_GET_STATUS;
	esp_tx_len = 1;

	esp_send_command();

	assert(esp_rx_len == (1 + 13 + 21) && esp_rx_buffer[0] == OPCODE_WIFI_STATUS_DATA);

	memcpy(mode, &esp_rx_buffer[1], 13);
	mode[12] = '\0';
	memcpy(status, &esp_rx_buffer[1 + 13], 21);
	status[20] = '\0';
	osMutexRelease(esp_ioHandle);
}

void esp_io_get_wifi_network_information(char ssid[21], char ip[21], int8_t* rssi) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_WIFI_GET_NETWORK_INFORMATION;
	esp_tx_len = 1;

	esp_send_command();

	assert(esp_rx_len == (1 + 21 + 21 + 1) && esp_rx_buffer[0] == OPCODE_WIFI_NETWORK_INFORMATION_DATA);

	memcpy(ssid, &esp_rx_buffer[1], 21);
	ssid[20] = '\0';
	memcpy(ip, &esp_rx_buffer[1 + 21], 21);
	ip[20] = '\0';
	*rssi = (int8_t)esp_rx_buffer[1 + 21 + 21];
	osMutexRelease(esp_ioHandle);
}

void esp_io_get_serial(char out[35]) {
	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_GET_SERIAL;
	esp_tx_len = 1;

	esp_send_command();

	out[0] = '\0';
	if (esp_rx_len >= 1 && esp_rx_buffer[0] == OPCODE_SERIAL_DATA) {
		size_t n = esp_rx_len - 1;
		if (n > 34) {
			n = 34;
		}
		memcpy(out, &esp_rx_buffer[1], n);
		out[n] = '\0';
	}
	osMutexRelease(esp_ioHandle);
}

bool esp_io_host_poll(uint8_t* tag, char* line, size_t cap) {
	bool got_line = false;

	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_HOST_POLL;
	esp_tx_len = 1;

	esp_send_command();

	// HOST_LINE: [0x88][tag][line...] (no terminator); anything else (PONG) means the queue is empty
	if (esp_rx_len >= 2 && esp_rx_buffer[0] == OPCODE_HOST_LINE && cap > 0) {
		size_t n = esp_rx_len - 2;
		if (n > cap - 1) {
			n = cap - 1;
		}
		*tag = esp_rx_buffer[1];
		memcpy(line, &esp_rx_buffer[2], n);
		line[n] = '\0';
		got_line = true;
	}
	osMutexRelease(esp_ioHandle);

	return got_line;
}

// Payload: [0x0F][tag u8][reply line ≤ 254 B]; the reply is PONG.
void esp_io_host_response(uint8_t tag, const char* line) {
	size_t n = strlen(line);
	if (n > ESP_PAYLOAD_MAX - 2) {
		n = ESP_PAYLOAD_MAX - 2;   // never exceed the frame payload (opcode + tag + line)
	}

	osMutexAcquire(esp_ioHandle, osWaitForever);
	esp_tx_buffer[0] = OPCODE_HOST_RESPONSE;
	esp_tx_buffer[1] = tag;
	memcpy(&esp_tx_buffer[2], line, n);
	esp_tx_len = (uint16_t)(2 + n);

	esp_send_command();

	// Reply is PONG; tolerate anything else rather than asserting on a host-path frame
	osMutexRelease(esp_ioHandle);
}

void esp_io_broadcast_lcd_text(const char front_buffer[][20]) {
	osMutexAcquire(esp_ioHandle, osWaitForever);

	esp_tx_buffer[0] = OPCODE_BROADCAST_LCD_TEXT0;
	memcpy(&esp_tx_buffer[1], front_buffer[0], 20);
	memcpy(&esp_tx_buffer[1 + 20], front_buffer[1], 20);
	esp_tx_len = 1 + 40;
	esp_send_command();
	assert(esp_rx_len == 1 && esp_rx_buffer[0] == OPCODE_PONG);

	esp_tx_buffer[0] = OPCODE_BROADCAST_LCD_TEXT1;
	memcpy(&esp_tx_buffer[1], front_buffer[2], 20);
	memcpy(&esp_tx_buffer[1 + 20], front_buffer[3], 20);
	esp_tx_len = 1 + 40;
	esp_send_command();
	assert(esp_rx_len == 3 && esp_rx_buffer[0] == OPCODE_PONG);

	int8_t rotary_adj = (int8_t)esp_rx_buffer[1];
	uint8_t button_pressed = esp_rx_buffer[2];

	if (rotary_adj != 0) {
		extern volatile int32_t encoder_counter;
		encoder_counter += rotary_adj;
	}
	if (button_pressed) {
		extern volatile uint8_t encoder_button_state;
		encoder_button_state = 1;
	}

	osMutexRelease(esp_ioHandle);
}
