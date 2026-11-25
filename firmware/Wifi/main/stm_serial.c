#include "stm_io.h"
#include "stm_serial.h"
#include "provisioning.h"

#include <stdint.h>
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "driver/uart.h"
#include "soc/uart_pins.h"
#include "esp_log.h"

static const char *TAG = "stm_serial";

// UART_NUM and UART_BAUD_RATE come from config.h. The driver's own ring buffers
// are sized independently of the UART_BUF_SIZE used for application buffers.
// A worst-case escaped frame is 2 * (4 + 4 + 256 + 4) + 2 = 538 bytes, so keep
// the driver ring buffers comfortably above that.
#define UART_DRV_BUF_SIZE 1024

// SLIP protocol constants
#define SLIP_END     0xC0
#define SLIP_ESC     0xDB
#define SLIP_ESC_END 0xDC
#define SLIP_ESC_ESC 0xDD

// Frame layout (see docs/serial-api.md, "STM32 <-> ESP32 link"):
//   request : [cmd_id:4][seq_id:4][payload <= SLIP_PAYLOAD_MAX][crc32:4]
//   reply   : [seq_id:4][payload <= SLIP_PAYLOAD_MAX][crc32:4]
// A few bytes of receive slack keep a marginally over-long HOST_RESPONSE from
// being dropped outright; host_reply() clamps what it forwards anyway.
#define SLIP_RX_SLACK 8
#define SLIP_RX_FRAME_MAX (4 + 4 + SLIP_PAYLOAD_MAX + SLIP_RX_SLACK + 4)

enum slip_state_t {
	SLIP_STATE_IDLE,
	SLIP_STATE_FRAME,
	SLIP_STATE_ESCAPE,
};

// Match STM32 hardware CRC peripheral: polynomial 0x04C11DB7,
// init 0xFFFFFFFF, no reflection, no final XOR, 32-bit word input.
static uint32_t compute_crc32(const uint8_t* data, size_t len) {
	size_t padded_len = (len + 3) & ~(size_t)3;
	uint32_t crc = 0xFFFFFFFF;
	for (size_t i = 0; i < padded_len; i += 4) {
		uint32_t word = 0;
		for (int j = 0; j < 4; j++) {
			uint8_t b = (i + j < len) ? data[i + j] : 0;
			word |= (uint32_t)b << (j * 8);
		}
		crc ^= word;
		for (int bit = 0; bit < 32; bit++) {
			if (crc & 0x80000000)
				crc = (crc << 1) ^ 0x04C11DB7;
			else
				crc = crc << 1;
		}
	}
	return crc;
}

static void slip_tx_byte(uint8_t b) {
	uart_write_bytes(UART_NUM, &b, 1);
}

static void slip_tx_escaped(uint8_t b) {
	if (b == SLIP_END) {
		slip_tx_byte(SLIP_ESC);
		slip_tx_byte(SLIP_ESC_END);
	} else if (b == SLIP_ESC) {
		slip_tx_byte(SLIP_ESC);
		slip_tx_byte(SLIP_ESC_ESC);
	} else {
		slip_tx_byte(b);
	}
}

static void slip_send_frame_with_seq(const uint8_t* data, uint16_t len, uint32_t sequence_id) {
	// CRC covers [sequence_id][payload]
	static uint8_t crc_input[4 + SLIP_PAYLOAD_MAX];
	if (len > SLIP_PAYLOAD_MAX) {
		len = SLIP_PAYLOAD_MAX;
	}
	memcpy(crc_input, &sequence_id, 4);
	memcpy(crc_input + 4, data, len);
	uint32_t crc = compute_crc32(crc_input, 4 + (size_t)len);

	slip_tx_byte(SLIP_END);
	for (int i = 0; i < 4; i++) {
		slip_tx_escaped((sequence_id >> (i * 8)) & 0xFF);
	}
	for (uint16_t i = 0; i < len; i++) {
		slip_tx_escaped(data[i]);
	}
	for (int i = 0; i < 4; i++) {
		slip_tx_escaped((crc >> (i * 8)) & 0xFF);
	}
	slip_tx_byte(SLIP_END);
	uart_wait_tx_done(UART_NUM, pdMS_TO_TICKS(100));
}

void stm_io_uart_task(void *arg) {
	// Initialize UART

    uart_config_t uart_config = {
        .baud_rate = UART_BAUD_RATE,
        .data_bits = UART_DATA_8_BITS,
        .parity = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
        .source_clk = UART_SCLK_DEFAULT,
    };

    ESP_ERROR_CHECK(uart_driver_install(UART_NUM, UART_DRV_BUF_SIZE * 2, UART_DRV_BUF_SIZE * 2, 0, NULL, 0));
    ESP_ERROR_CHECK(uart_param_config(UART_NUM, &uart_config));

    // These should be the default pins, but set them explicitly.
    // Must stay on the IOMUX UART0 pins (C5: TX=11/RX=12, C3 was TX=21/RX=20):
    // the STM32 bootloader talks to the same wires in ROM download mode.
    ESP_ERROR_CHECK(uart_set_pin(UART_NUM, U0TXD_GPIO_NUM, U0RXD_GPIO_NUM,
                                 UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE));

    ESP_LOGI(TAG, "UART%d initialized: baud=%d", UART_NUM, UART_BAUD_RATE);

	uart_flush_input(UART_NUM);

	static uint8_t rx_frame[SLIP_RX_FRAME_MAX]; // 4 cmd_id + 4 seq_id + payload + 4 crc
	uint16_t rx_frame_len = 0;
	bool rx_overflow = false;
	enum slip_state_t state = SLIP_STATE_IDLE;
	static uint32_t last_command_id = UINT32_MAX;

	static uint8_t tx_buf[SLIP_PAYLOAD_MAX];
	static uint8_t chunk[256];
	uint16_t tx_len;

	bool stop = false;

	while(!stop) {
		int nread = uart_read_bytes(UART_NUM, chunk, sizeof(chunk), pdMS_TO_TICKS(100));
		if (nread <= 0) {
			// ESP_LOGW(TAG, "uart_read_bytes returned %d, state %d, resetting", nread, state);
			state = SLIP_STATE_IDLE;
			rx_frame_len = 0;
			rx_overflow = false;
			continue;
		}

		for (int ci = 0; ci < nread; ci++) {
			uint8_t b = chunk[ci];

			switch (state) {
			case SLIP_STATE_IDLE:
				if (b == SLIP_END) {
					// ESP_LOGD(TAG, "IDLE: got END, -> FRAME");
					state = SLIP_STATE_FRAME;
					rx_frame_len = 0;
					rx_overflow = false;
				}
				break;

			case SLIP_STATE_FRAME:
				if (b == SLIP_END) {
					if (rx_frame_len >= 12 && !rx_overflow) {
						// Frame: [cmd_id:4][seq_id:4][payload][CRC:4]
						// CRC covers everything except last 4 bytes
						uint16_t crc_len = rx_frame_len - 4;
						uint32_t expected_crc = 0;
						for (int i = 0; i < 4; i++) {
							expected_crc |= (uint32_t)rx_frame[crc_len + i] << (i * 8);
						}
						uint32_t calc_crc = compute_crc32(rx_frame, crc_len);

						if (calc_crc == expected_crc) {
							uint32_t command_id = 0, sequence_id = 0;
							for (int i = 0; i < 4; i++) {
								command_id  |= (uint32_t)rx_frame[i] << (i * 8);
								sequence_id |= (uint32_t)rx_frame[4 + i] << (i * 8);
							}

							bool is_retransmission = (command_id == last_command_id);
							last_command_id = command_id;

							uint8_t* payload = rx_frame + 8;
							uint16_t payload_len = crc_len - 8;

							tx_len = 0;
							stop = stm_io_process(payload, payload_len, tx_buf, &tx_len, is_retransmission);
							slip_send_frame_with_seq(tx_buf, tx_len, sequence_id);
						}
					} else if (rx_frame_len > 0) {
						// ESP_LOGW(TAG, "Frame rejected: len=%d overflow=%d", rx_frame_len, rx_overflow);
					}
					// Reset for next frame
					rx_frame_len = 0;
					rx_overflow = false;
					// Stay in FRAME state
				} else if (b == SLIP_ESC) {
					state = SLIP_STATE_ESCAPE;
				} else {
					if (rx_frame_len < sizeof(rx_frame))
						rx_frame[rx_frame_len++] = b;
					else
						rx_overflow = true;
				}
				break;

			case SLIP_STATE_ESCAPE:
				if (b == SLIP_ESC_END) {
					if (rx_frame_len < sizeof(rx_frame))
						rx_frame[rx_frame_len++] = SLIP_END;
					else
						rx_overflow = true;
				} else if (b == SLIP_ESC_ESC) {
					if (rx_frame_len < sizeof(rx_frame))
						rx_frame[rx_frame_len++] = SLIP_ESC;
					else
						rx_overflow = true;
				} else {
					// ESP_LOGW(TAG, "Bad escape byte: 0x%02X", b);
					rx_overflow = true;
				}
				state = SLIP_STATE_FRAME;
				break;
			}
		}
	}

	if (s_prov_state.prov_mode == PROV_MODE_UNPROVISIONED) {
		// The provisioning task runs the shared SCPI dispatcher whose context
		// (4 KB line + 4 KB reply) and error path live partly on the stack, on
		// top of the mTLS handler's decode buffers - give it plenty of room.
		TaskHandle_t prov_task_handle = NULL;
		xTaskCreate(provisioning_uart_task, "prov_uart", 16384, NULL, 10, &prov_task_handle);
	}

	vTaskDelete(NULL);
}
