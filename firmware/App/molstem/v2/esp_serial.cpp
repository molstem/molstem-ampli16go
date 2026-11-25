#include "esp_serial.h"
#include <cstring>

extern "C" {
	#include "cmsis_os2.h"
	#include "usart.h"
	#include "crc.h"
	#include "usbd_cdc_if.h"
}

extern osSemaphoreId_t esp_rx_rcvdHandle;
extern osSemaphoreId_t esp_rx_ackdHandle;
extern osSemaphoreId_t esp_tx_rdyHandle;

uint8_t esp_tx_buffer[ESP_PAYLOAD_MAX + 4];
uint16_t esp_tx_len;

uint8_t esp_rx_buffer[ESP_PAYLOAD_MAX + 4];
uint16_t esp_rx_len;
static uint32_t esp_rx_seq_id;

// Longest frame body: 4 cmd/seq id + 4 seq id + payload + 4 crc, rounded up to a
// multiple of 4 so compute_crc32() can pad in place.
#define SLIP_FRAME_MAX ((4 + 4 + ESP_PAYLOAD_MAX + 4 + 3) & ~3)

static uint8_t slip_rx_buffer[SLIP_FRAME_MAX]; // [seq_id:4][payload][crc:4] + padding
static uint16_t slip_rx_len;

static uint8_t crc_input[SLIP_FRAME_MAX];      // [command_id:4][sequence_id:4][payload] + padding (esp_tx thread only)

static uint32_t esp_command_id = 0;
static uint32_t esp_sequence_id = 0;
static volatile uint32_t esp_expected_sequence_id = 0;

#define ESP_REPLY_TIMEOUT_MS 400

#define RX_BUF_SIZE 1024
static uint8_t slip_rx_buf[RX_BUF_SIZE];

// SLIP protocol constants
#define SLIP_END     0xC0
#define SLIP_ESC     0xDB
#define SLIP_ESC_END 0xDC
#define SLIP_ESC_ESC 0xDD

enum slip_state_t {
	SLIP_STATE_IDLE,
	SLIP_STATE_FRAME,
	SLIP_STATE_ESCAPE,
};

// SLIP RX decoder state
static slip_state_t slip_state;

static bool slip_frame_overflow;

static void slip_tx_byte(uint8_t b) {
	HAL_UART_Transmit(&huart2, &b, 1, HAL_MAX_DELAY);
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

static uint32_t compute_crc32(uint8_t* data, uint16_t len) {
	// Pad to multiple of 4 bytes for CRC peripheral (buffers are SLIP_FRAME_MAX, a multiple of 4)
	uint16_t padded_len = (len + 3) & ~3;
	memset(data + len, 0, padded_len - len);
	return HAL_CRC_Calculate(&hcrc, (uint32_t*)data, padded_len / 4);
}


extern volatile uint8_t provision_status;

extern "C" void esp_tx_handler() {

	// Start UART2 in DMA RX mode
	HAL_UARTEx_ReceiveToIdle_DMA(&huart2, slip_rx_buf, RX_BUF_SIZE);

	while(provision_status != 0) {
		// Wait for a frame to send
		osSemaphoreAcquire(esp_tx_rdyHandle, osWaitForever);

		esp_command_id++;

		while(provision_status != 0) {
			esp_sequence_id++;
			esp_expected_sequence_id = esp_sequence_id;

			// Clamp a malformed request rather than overrunning the frame buffers
			if (esp_tx_len > ESP_PAYLOAD_MAX) {
				esp_tx_len = ESP_PAYLOAD_MAX;
			}

			// Build CRC input: [command_id][sequence_id][payload]
			memcpy(crc_input, &esp_command_id, 4);
			memcpy(crc_input + 4, &esp_sequence_id, 4);
			memcpy(crc_input + 8, esp_tx_buffer, esp_tx_len);
			uint32_t crc = compute_crc32(crc_input, 8 + esp_tx_len);

			// Send SLIP frame: END [cmd_id] [seq_id] [payload] [CRC] END
			slip_tx_byte(SLIP_END);

			for (int i = 0; i < 4; i++) {
				slip_tx_escaped((esp_command_id >> (i * 8)) & 0xFF);
			}
			for (int i = 0; i < 4; i++) {
				slip_tx_escaped((esp_sequence_id >> (i * 8)) & 0xFF);
			}
			for (uint16_t i = 0; i < esp_tx_len; i++) {
				slip_tx_escaped(esp_tx_buffer[i]);
			}
			for (int i = 0; i < 4; i++) {
				slip_tx_escaped((crc >> (i * 8)) & 0xFF);
			}

			slip_tx_byte(SLIP_END);

			// Wait for response
			if (osSemaphoreAcquire(esp_rx_rcvdHandle, ESP_REPLY_TIMEOUT_MS) == osOK && esp_rx_seq_id == esp_expected_sequence_id) {
				// Got a response, signal ack back to caller
				osSemaphoreRelease(esp_rx_ackdHandle);
				break;
			} else {
				// Timeout - retry transmission
				continue;
			}
		}
	}
}

static void slip_rx_reset() {
	slip_rx_len = 0;
	slip_frame_overflow = false;
}

static void slip_rx_store(uint8_t b) {
	// Longest valid frame body is 4 seq_id + ESP_PAYLOAD_MAX + 4 crc; keep the
	// trailing bytes of the buffer free so compute_crc32() can pad in place.
	if (slip_rx_len < 4 + ESP_PAYLOAD_MAX + 4) {
		slip_rx_buffer[slip_rx_len++] = b;
	} else {
		slip_frame_overflow = true;
	}
}

static void slip_rx_complete() {
	// Frame: [sequence_id:4][payload][CRC:4], minimum 8 bytes
	if (slip_frame_overflow || slip_rx_len < 8) {
		slip_rx_reset();
		return;
	}

	// CRC covers everything except last 4 bytes
	uint16_t crc_len = slip_rx_len - 4;
	uint32_t expected_crc = 0;
	for (int i = 0; i < 4; i++) {
		expected_crc |= (uint32_t)slip_rx_buffer[crc_len + i] << (i * 8);
	}

	uint32_t calc_crc = compute_crc32(slip_rx_buffer, crc_len);

	if (calc_crc != expected_crc) {
		slip_rx_reset();
		return;
	}

	// Extract sequence_id (first 4 bytes)
	uint32_t rx_sequence_id = 0;
	for (int i = 0; i < 4; i++) {
		rx_sequence_id |= (uint32_t)slip_rx_buffer[i] << (i * 8);
	}

	// Ignore stale replies
	if (rx_sequence_id != esp_expected_sequence_id) {
		slip_rx_reset();
		return;
	}

	// Copy payload (skip sequence_id, exclude CRC); at most ESP_PAYLOAD_MAX by construction
	uint16_t payload_len = crc_len - 4;
	memcpy(esp_rx_buffer, slip_rx_buffer + 4, payload_len);
	esp_rx_len = payload_len;
	esp_rx_seq_id = rx_sequence_id;
	osSemaphoreRelease(esp_rx_rcvdHandle);

	slip_rx_reset();
}

void uart_process_bytes(uint8_t* start, uint16_t Size) {
	if (provision_status == 0) {
		// Forward to CDC_Transmit_FS
		CDC_Transmit_FS(start, Size);
	} else {
		for (uint16_t i = 0; i < Size; i++) {
			uint8_t b = start[i];

			switch (slip_state) {
			case SLIP_STATE_IDLE:
				if (b == SLIP_END) {
					slip_state = SLIP_STATE_FRAME;
					slip_rx_reset();
				}
				break;

			case SLIP_STATE_FRAME:
				if (b == SLIP_END) {
					// End of frame (or consecutive delimiters)
					if (slip_rx_len > 0) {
						slip_rx_complete();
					}
					slip_rx_reset();
					// Stay in FRAME state for next frame
				} else if (b == SLIP_ESC) {
					slip_state = SLIP_STATE_ESCAPE;
				} else {
					slip_rx_store(b);
				}
				break;

			case SLIP_STATE_ESCAPE:
				if (b == SLIP_ESC_END) {
					slip_rx_store(SLIP_END);
				} else if (b == SLIP_ESC_ESC) {
					slip_rx_store(SLIP_ESC);
				} else {
					// Protocol error, discard
					slip_frame_overflow = true;
				}
				slip_state = SLIP_STATE_FRAME;
				break;
			}
		}
	}
}

extern "C" void HAL_UARTEx_RxEventCallback(UART_HandleTypeDef *huart, uint16_t Size) {
	static uint16_t rx_head = 0;

	if (huart != &huart2) return;

	if (Size >= rx_head) {
		uart_process_bytes(&slip_rx_buf[rx_head], Size - rx_head);
	} else {
		// Wrapped around
		uart_process_bytes(&slip_rx_buf[rx_head], RX_BUF_SIZE - rx_head);
		uart_process_bytes(&slip_rx_buf[0], Size);
	}

	rx_head = Size;
	if (rx_head >= RX_BUF_SIZE) {
		rx_head = 0;
	}
}

void esp_send_command() {
	osSemaphoreRelease(esp_tx_rdyHandle);
	osSemaphoreAcquire(esp_rx_ackdHandle, osWaitForever);
}
