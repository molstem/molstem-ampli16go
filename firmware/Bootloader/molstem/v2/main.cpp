#include <cstdint>
#include <cmath>
#include <cstdbool>
#include <cstdio>
#include <cstring>


#include "git-version.h"


extern "C" {
	#include "stm32f4xx_hal.h"
	#include "stm32f4xx_hal_flash.h"
	#include "stm32f4xx_hal_flash_ex.h"

	#include "usbd_cdc_if.h"
	#include "drivers/lcd.h"
	#include "usart.h"
	#include "helpers/scpi_line.h"
}

#include "mbedtls.h"
#include "pk.h"
#include "sha256.h"
#include "esp_flasher.hpp"
#include "fwu.hpp"
#include "boot_scpi.hpp"

#define APP_SIZE (FWU_APP_SIZE)
#define APP_BASE (FWU_APP_BASE)
#define APP_VERSION_BASE (APP_BASE + APP_SIZE - 128)
#define APP_VERSION_SIZE (20)
#define APP_SIGNATURE_BASE (APP_BASE + APP_SIZE - 64)
#define APP_SINGATURE_SIZE (64)

// ---------------------------------------------------------------------------
// .fwu stream state machine (see fwu.hpp)
// ---------------------------------------------------------------------------

constexpr uint32_t FWU_TOTAL_SIZE = FWU_COOKIE_LEN + SLICE0_SIZE + SLICE1_SIZE + APP_SIZE;
static_assert(FWU_TOTAL_SIZE == 4497418u, "FWU_TOTAL_SIZE must match the .fwu produced by make_fwu.py");

extern EspFlasher flasher;   // defined below, after the LCD handle

static FwuState    fwu_st = FwuState::WAIT;
static FwuState    fwu_err_stage = FwuState::WAIT;   // state in which the error happened
static uint32_t    fwu_bytes = 0;                     // stream bytes accepted so far
static uint32_t    fwu_cookie_pos = 0;
static int         fwu_err_code = 0;
static const char* fwu_err_msg = nullptr;
static char        fwu_err_buf[48];
static uint32_t    fwu_done_at = 0;

static uint32_t write_address = 0;
static uint8_t  programming_buffer[4];

FwuState    fwu_state()       { return fwu_st; }
uint32_t    fwu_bytes_total() { return fwu_bytes; }
uint32_t    fwu_total_size()  { return FWU_TOTAL_SIZE; }
const char* fwu_error()       { return fwu_err_msg; }

const char* fwu_state_name(FwuState s) {
	switch (s) {
	case FwuState::WAIT:  return "WAIT";
	case FwuState::ESP:   return "ESP";
	case FwuState::STM:   return "STM";
	case FwuState::DONE:  return "DONE";
	case FwuState::ERROR: return "ERROR";
	}
	return "ERROR";
}

static int fwu_fail(int code, const char* msg, const char** err_msg) {
	fwu_err_stage = fwu_st;
	fwu_st = FwuState::ERROR;
	fwu_err_code = code;
	fwu_err_msg = msg;
	*err_msg = msg;
	return code;
}

// Program one word; returns false on a persistent flash error.
static bool stm_program_word(uint32_t address, uint32_t val) {
	for (int attempt = 0; attempt < 3; attempt++) {
		__disable_irq();
		HAL_StatusTypeDef rc = HAL_FLASH_Program(FLASH_TYPEPROGRAM_WORD, address, val);
		__enable_irq();
		if (rc == HAL_OK) {
			return true;
		}
	}
	return false;
}

int fwu_feed(const uint8_t* data, uint32_t len, const char** err_msg) {
	*err_msg = nullptr;

	if (fwu_st == FwuState::ERROR) {
		*err_msg = fwu_err_msg;
		return fwu_err_code;
	}

	while (len != 0) {
		switch (fwu_st) {
		case FwuState::WAIT:
			if (*data != (uint8_t)FWU_COOKIE[fwu_cookie_pos]) {
				snprintf(fwu_err_buf, sizeof(fwu_err_buf), "bad cookie at byte %lu", (unsigned long)fwu_bytes);
				return fwu_fail(SCPI_ERR_BAD_COOKIE, fwu_err_buf, err_msg);
			}
			data++;
			len--;
			fwu_bytes++;
			fwu_cookie_pos++;
			if (fwu_cookie_pos == FWU_COOKIE_LEN) {
				fwu_st = FwuState::ESP;
			}
			break;

		case FwuState::ESP: {
			// Blocks until the bytes are written (16 KB blocks at 3 Mbaud, plus the
			// slice erases). Returns the number of bytes it did not take.
			uint32_t remaining = flasher.feedData(data, len);
			uint32_t consumed = (remaining <= len) ? (len - remaining) : len;
			fwu_bytes += consumed;
			data += consumed;
			len -= consumed;

			if (flasher.getState() == EspFlashState::ERROR) {
				const char* msg = flasher.getLastError();
				return fwu_fail(SCPI_ERR_FLASH, (msg && *msg) ? msg : "esp32 flash failed", err_msg);
			}
			if (flasher.isSuccess()) {
				fwu_st = FwuState::STM;
			} else if (consumed == 0) {
				// feedData only leaves bytes behind when it is done or failed.
				return fwu_fail(SCPI_ERR_FLASH, "esp32 flasher stalled", err_msg);
			}
			break;
		}

		case FwuState::STM: {
			uint32_t buffer_address = write_address & 3;
			uint32_t program_address = write_address & ~3u;

			programming_buffer[buffer_address] = *data;
			if (buffer_address == 3) {
				uint32_t val = programming_buffer[0] | (programming_buffer[1] << 8) |
				               (programming_buffer[2] << 16) | (programming_buffer[3] << 24);

				if (program_address < APP_BASE || (program_address + 3) >= (APP_BASE + APP_SIZE) ||
				    !stm_program_word(program_address, val)) {
					snprintf(fwu_err_buf, sizeof(fwu_err_buf), "stm32 program failed at 0x%08lx", (unsigned long)program_address);
					return fwu_fail(SCPI_ERR_FLASH, fwu_err_buf, err_msg);
				}
			}
			data++;
			len--;
			fwu_bytes++;
			write_address++;

			if (write_address == (APP_BASE + APP_SIZE)) {
				fwu_st = FwuState::DONE;
				fwu_done_at = HAL_GetTick();
			}
			break;
		}

		case FwuState::DONE:
			// Image complete: refuse the extra bytes but stay DONE (reboot pending).
			*err_msg = nullptr;
			return SCPI_ERR_ALREADY_DONE;

		case FwuState::ERROR:
			*err_msg = fwu_err_msg;
			return fwu_err_code;
		}
	}

	return SCPI_OK;
}

#define UART_RX_BUF_SZ 512
static uint8_t uart_rx_dma[UART_RX_BUF_SZ];

static uint16_t uart_read_pos = 0;

// Read from UART DMA buffer - returns number of bytes read (non-blocking)
static int uart_dma_read(uint8_t* buf, uint32_t max_len) {
    uint16_t dma_pos = UART_RX_BUF_SZ - __HAL_DMA_GET_COUNTER(huart2.hdmarx);

    if (uart_read_pos == dma_pos) {
        return 0;  // No data available
    }

    uint32_t read_count = 0;
    while (uart_read_pos != dma_pos && read_count < max_len) {
        buf[read_count++] = uart_rx_dma[uart_read_pos];
        uart_read_pos++;
        if (uart_read_pos >= UART_RX_BUF_SZ) {
            uart_read_pos = 0;
        }
    }

    return (int)read_count;
}

Lcd_HandleTypeDef lcd;

Lcd_PortType lcd_ports[] = {LCD_D4_GPIO_Port, LCD_D5_GPIO_Port, LCD_D6_GPIO_Port, LCD_D7_GPIO_Port};
Lcd_PinType lcd_pins[] = {LCD_D4_Pin, LCD_D5_Pin, LCD_D6_Pin, LCD_D7_Pin};


void display_init() {
	lcd = Lcd_create(lcd_ports, lcd_pins, LCD_RS_GPIO_Port, LCD_RS_Pin, LCD_EN_GPIO_Port, LCD_EN_Pin, LCD_4_BIT_MODE);
}

static const uint8_t public_key_der[91] = {
	0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02,
	0x01, 0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03,
	0x42, 0x00, 0x04, 0x51, 0x9F, 0x27, 0xAA, 0x6B, 0x5E, 0xBF, 0x6A, 0x49,
	0x71, 0xE4, 0xA6, 0x00, 0x6E, 0x58, 0xF2, 0x9A, 0xBC, 0xCF, 0x30, 0x8D,
	0xAB, 0x13, 0x11, 0x77, 0x0F, 0xB3, 0x33, 0xD3, 0x86, 0x5B, 0x00, 0x90,
	0xE7, 0x87, 0xD0, 0xA0, 0x93, 0x1B, 0x9A, 0x09, 0x8C, 0x4F, 0xE0, 0xD2,
	0xF8, 0x95, 0x3A, 0xA4, 0x1F, 0x33, 0x69, 0x93, 0x30, 0x2C, 0xE8, 0x6C,
	0x8C, 0x5D, 0xE4, 0x11, 0xA9, 0x56, 0x04
};

static const size_t public_key_der_len = sizeof(public_key_der);

void compute_sha256(const uint8_t *data, size_t len, uint8_t slice0[32], uint8_t slice1[32], uint8_t out[32])
{
    mbedtls_sha256_context ctx;

    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts_ret(&ctx, 0);    // 0 = SHA-256, 1 = SHA-224
    mbedtls_sha256_update_ret(&ctx, data, len);
	mbedtls_sha256_update_ret(&ctx, slice0, 32);
	mbedtls_sha256_update_ret(&ctx, slice1, 32);
    mbedtls_sha256_finish_ret(&ctx, out);

    mbedtls_sha256_free(&ctx);
}

int verify_raw_signature(mbedtls_ecdsa_context *ecdsa,
                         const uint8_t hash[32],
                         const uint8_t sig_raw[64])
{
    mbedtls_mpi r, s;
    mbedtls_mpi_init(&r);
    mbedtls_mpi_init(&s);

    // r = sig_raw[0..31]
    // s = sig_raw[32..63]
    int ret = mbedtls_mpi_read_binary(&r, &sig_raw[0], 32);
    if (ret != 0) goto cleanup;

    ret = mbedtls_mpi_read_binary(&s, &sig_raw[32], 32);
    if (ret != 0) goto cleanup;

    ret = mbedtls_ecdsa_verify(&ecdsa->grp,
                               hash,
                               32,
                               &ecdsa->Q,
                               &r,
                               &s);

cleanup:
    mbedtls_mpi_free(&r);
    mbedtls_mpi_free(&s);
    return ret;    // 0 = OK, !=0 = invalid signature
}

bool is_singature_valid() {
	auto sig = (uint8_t*)APP_SIGNATURE_BASE;
	for (unsigned i = 0; i < APP_SINGATURE_SIZE; i++) {
		if (sig[i] == 0 || sig[i] == 0xFF) {
			continue;
		}
		return true;
	}

	return false;
}

bool is_app_valid(uint8_t slice0[32], uint8_t slice1[32]) {
	mbedtls_pk_context pk;
	mbedtls_pk_init(&pk);

	if (mbedtls_pk_parse_public_key(&pk, public_key_der, public_key_der_len) != 0) {
		mbedtls_pk_free(&pk);
		return false;
	}

	mbedtls_ecdsa_context *ecdsa = mbedtls_pk_ec(pk);

	uint8_t hash[32];
	compute_sha256((const uint8_t*)APP_BASE, APP_SIZE - APP_SINGATURE_SIZE, slice0, slice1, hash);

	int ret = verify_raw_signature(ecdsa, hash, (const uint8_t*)(APP_SIGNATURE_BASE));

	mbedtls_pk_free(&pk);

	return ret == 0;
}

void jump_to_application(void)
{
    // 1. Disable interrupts
    __disable_irq();

    // 2. Stop DMA and UART
    HAL_UART_DMAStop(&huart2);
    HAL_UART_DeInit(&huart2);

    // 3. Stop USB
    // (Add USB de-init if you have a handle, e.g., USBD_Stop(&hUsbDeviceFS))

    // 4. De-init HAL
    HAL_RCC_DeInit();
    HAL_DeInit();

    // 5. Stop SysTick
    SysTick->CTRL = 0;
    SysTick->LOAD = 0;
    SysTick->VAL  = 0;

    // 6. Clear all pending NVIC interrupts
    for (int i = 0; i < 8; i++) {
        NVIC->ICER[i] = 0xFFFFFFFF;  // Disable all interrupts
        NVIC->ICPR[i] = 0xFFFFFFFF;  // Clear all pending
    }

    // 7. Read application's vector table
    uint32_t app_msp   = *(volatile uint32_t *)(APP_BASE + 0);
    uint32_t app_reset = *(volatile uint32_t *)(APP_BASE + 4);

    // 8. Set vector table offset
    SCB->VTOR = APP_BASE;

    // 9. Memory barrier
    __DSB();
    __ISB();

    // 10. Set MSP
    __set_MSP(app_msp);

    // 11. Jump to reset handler (don't re-enable IRQ - let app do it)
    ((void(*)(void))app_reset)();

    while (1);
}

EspFlasher flasher(&huart2, &lcd);

extern "C" int molstem_before_kernel_start()
{
	MX_MBEDTLS_Init();

	display_init();

	Lcd_clear(&lcd);

	Lcd_cursor(&lcd, 1, 0);
	Lcd_string(&lcd, "      molstem       ");

	char version[21] = { 0 };
	memcpy(version, (const char*)APP_VERSION_BASE, 20);
	if (strlen(version) == 0 || !is_singature_valid()) {
		memcpy(version, "      Bootloader    ", sizeof(version));
	}

	Lcd_cursor(&lcd, 2, 0);
	Lcd_string(&lcd, version);

	uint8_t slice_0_sha256[32];
	uint8_t slice_1_sha256[32];

	{
		// Reset ESP32 in download mode
		HAL_GPIO_WritePin(ESP_EN_GPIO_Port, ESP_EN_Pin, GPIO_PIN_RESET);
		
		HAL_GPIO_WritePin(ESP_BOOT_GPIO_Port, ESP_BOOT_Pin, GPIO_PIN_RESET);
		HAL_GPIO_WritePin(ESP_GP8_GPIO_Port, ESP_GP8_Pin, GPIO_PIN_SET);
		HAL_GPIO_WritePin(ESP_GP2_GPIO_Port, ESP_GP2_Pin, GPIO_PIN_SET);

		// Keep reset low for some time
		HAL_Delay(100);

		HAL_GPIO_WritePin(ESP_EN_GPIO_Port, ESP_EN_Pin, GPIO_PIN_SET);

		// Wait for ESP32 to boot
		HAL_Delay(100);

		// Start UART DMA receive after ESP32 has booted
		HAL_UART_Receive_DMA(&huart2, uart_rx_dma, UART_RX_BUF_SZ);
		uart_read_pos = 0;

		// Init stub flasher
		
		// Set UART read callback for DMA-based RX (TX uses blocking HAL)
		flasher.setUartReadCallback(uart_dma_read);
		flasher.setUartSetBaudrateCallback([](uint32_t new_baud) {
			HAL_UART_AbortReceive(&huart2);

			// Flush RX buffer before switching
			while (__HAL_UART_GET_FLAG(&huart2, UART_FLAG_RXNE)) {
				(void)huart2.Instance->DR;
			}

			huart2.Init.BaudRate = new_baud;
			huart2.Init.OverSampling = UART_OVERSAMPLING_8;
			HAL_UART_Init(&huart2);

			HAL_UART_Receive_DMA(&huart2, uart_rx_dma, UART_RX_BUF_SZ);
		});

		
		if (!flasher.initStub()) {
			Lcd_cursor(&lcd, 2, 0);
			Lcd_string(&lcd, "ESP32 INIT ERROR");
			HAL_Delay(3000);
			goto reboot;
		}

		if (is_singature_valid()) {
			if (!flasher.readFlashSha256(SLICE0_OFFSET, SLICE0_SIZE, slice_0_sha256)) {
				Lcd_cursor(&lcd, 2, 0);
				Lcd_string(&lcd, "ESP32 HASH0 ERROR");
				HAL_Delay(3000);
				goto reboot;
			}

			if (!flasher.readFlashSha256(SLICE1_OFFSET, SLICE1_SIZE, slice_1_sha256)) {
				Lcd_cursor(&lcd, 2, 0);
				Lcd_string(&lcd, "ESP32 HASH1 ERROR");
				HAL_Delay(3000);
				goto reboot;
			}
		}
	}

	if (is_singature_valid() && is_app_valid(slice_0_sha256, slice_1_sha256)) {
		// turn esp32 off
		HAL_GPIO_WritePin(ESP_EN_GPIO_Port, ESP_EN_Pin, GPIO_PIN_RESET);
		HAL_Delay(20);
		jump_to_application();
	}

	Lcd_clear(&lcd);

	Lcd_cursor(&lcd, 0, 0);
	Lcd_string(&lcd, "Firmware Update");

	Lcd_cursor(&lcd, 1, 0);
	Lcd_string(&lcd, "Erasing...          ");

	HAL_FLASH_Unlock();
	{
		__HAL_FLASH_CLEAR_FLAG(FLASH_FLAG_EOP | FLASH_FLAG_OPERR | FLASH_FLAG_WRPERR |
		                       FLASH_FLAG_PGAERR | FLASH_FLAG_PGPERR | FLASH_FLAG_PGSERR |
		                       FLASH_FLAG_RDERR | FLASH_FLAG_BSY);

		FLASH_EraseInitTypeDef EraseInitStruct;
		uint32_t SectorError = 0;

		EraseInitStruct.TypeErase = FLASH_TYPEERASE_SECTORS;
		EraseInitStruct.VoltageRange = FLASH_VOLTAGE_RANGE_3;  // For VDD 2.7–3.6V
		EraseInitStruct.Sector = FLASH_SECTOR_5;
		EraseInitStruct.NbSectors = 3;

		if (HAL_FLASHEx_Erase(&EraseInitStruct, &SectorError) != HAL_OK) {
			Lcd_cursor(&lcd, 1, 0);
			Lcd_string(&lcd, "Failed to ERASE");
			HAL_FLASH_Lock();
			for(;;);
		}
	}

	write_address = APP_BASE;
	fwu_st = FwuState::WAIT;
	fwu_bytes = 0;
	fwu_cookie_pos = 0;
	fwu_err_msg = nullptr;

	boot_scpi::init();

	// Start the ESP32 flasher state machine; bytes arrive through BOOT:DATA.
	flasher.start();

	{
		uint32_t last_lcd_tick = HAL_GetTick() - 500;
		bool final_shown = false;

		for (;;) {
			boot_scpi::tx_pump();
			boot_scpi::usb_poll();   // may block inside fwu_feed (ESP32 erase / block write)

			uint32_t now = HAL_GetTick();
			FwuState st = fwu_state();

			if ((now - last_lcd_tick) >= 500) {
				last_lcd_tick = now;

				char buffer[64];
				uint32_t bytes = fwu_bytes_total();
				int percent = (int)(((uint64_t)bytes * 100u) / FWU_TOTAL_SIZE);

				// Legacy banner for old hosts, until the first SCPI command arrives.
				if (!boot_scpi::command_received()) {
					snprintf(buffer, sizeof(buffer), "BOOTLOADER: %s, programming: %3d%%", GIT_VERSION, percent);
					boot_scpi::queue_line(buffer);
				}

				if (st == FwuState::ERROR) {
					if (!final_shown) {
						final_shown = true;
						snprintf(buffer, sizeof(buffer), "Writing:    %08x", (int)write_address);
						Lcd_cursor(&lcd, 1, 0);
						Lcd_string(&lcd, buffer);
						Lcd_cursor(&lcd, 2, 0);
						Lcd_string(&lcd, fwu_err_stage == FwuState::STM ? "Failed to WRITE     " : "ESP32-FAILED        ");
						HAL_FLASH_Lock();
					}
				} else if (st == FwuState::DONE) {
					if (!final_shown) {
						final_shown = true;
						HAL_FLASH_Lock();
						Lcd_clear(&lcd);
						Lcd_cursor(&lcd, 0, 0);
						Lcd_string(&lcd, "Rebooting....");
					}
				} else {
					uint32_t shown = (st == FwuState::STM) ? write_address : flasher.getBytesRecieved();
					snprintf(buffer, sizeof(buffer), "Writing:    %08x", (int)shown);
					Lcd_cursor(&lcd, 1, 0);
					Lcd_string(&lcd, buffer);

					snprintf(buffer, sizeof(buffer), "Progress:       %3d%%", percent);
					Lcd_cursor(&lcd, 3, 0);
					Lcd_string(&lcd, buffer);
				}
			}

			if (st == FwuState::DONE && (now - fwu_done_at) >= 1000) {
				HAL_FLASH_Lock();
				break;
			}

			if (boot_scpi::reset_pending() && (now - boot_scpi::reset_request_tick()) >= 50) {
				HAL_FLASH_Lock();
				break;
			}
		}
	}

    reboot:
	__disable_irq();
	NVIC_SystemReset();

	return 1;
}
