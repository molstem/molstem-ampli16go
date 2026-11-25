#include <cstdint>
#include <cmath>
#include <cstdbool>
#include <atomic>

#include "drivers/drivers.hpp"
#include "control/control.hpp"

extern "C" {
	#include "cmsis_os2.h"
	#include "usbd_cdc_if.h"
	#include "usart.h"

	#include "control/temp_control_pid.h"
}


#include "helpers/microtask_scheduler.hpp"
#include "tui.h"
#include "esp_io.h"
#include "scpi_app.h"

extern "C" {
	#include "drivers/lcd.h"
}
extern char front_buffer[LCD_ROWS][LCD_COLS];

microtask::MicrotaskScheduler scheduler;

static uint8_t* volatile usb_rx_buffer;
static uint32_t usb_rx_buffer_len;

extern "C" void usb_on_recieve_data(uint8_t* Buf, uint32_t *pLen) {
	usb_rx_buffer_len = *pLen;
	usb_rx_buffer = Buf;

	// Don't ACK here, will re-arm when the buffer drains
}

extern USBD_HandleTypeDef hUsbDeviceFS;

unsigned wifi;
unsigned buzzer;
volatile uint8_t provision_status = 255; // unknown at start

extern "C" void uart_bridge_handler()
{
	for(;;)
	{
		if (!usb_rx_buffer) {
			osThreadYield();
			continue;
		}

		if (provision_status == 0) {
			// write to usart2
			HAL_UART_Transmit(&huart2, usb_rx_buffer, usb_rx_buffer_len, HAL_MAX_DELAY);
		} else if (provision_status == 1 || provision_status == 2) {
			// provisioned: the packet is SCPI traffic for the application
			scpi_app_usb_feed(usb_rx_buffer, usb_rx_buffer_len);
		}
		// 255 (provision status unknown yet): discard

		auto buffer = usb_rx_buffer;
		usb_rx_buffer = nullptr;

		// ACK USB RX buffer
		USBD_CDC_SetRxBuffer(&hUsbDeviceFS, buffer);
  		USBD_CDC_ReceivePacket(&hUsbDeviceFS);
	}
}


// 100 ms ESP32 tick: LCD mirror (+ virtual input piggyback), host request lines
// from the local /ws and cloud sockets, and the 1 s network status refresh.
extern "C" void usb_logging_handler()
{
    TickType_t xLastWakeTime = xTaskGetTickCount();
    unsigned tick = 0;

    for(;;)
    {
		vTaskDelayUntil(&xLastWakeTime, pdMS_TO_TICKS(100));

		if (provision_status == 0 || provision_status == 255) {
			continue;
		}

		esp_io_broadcast_lcd_text(front_buffer);
		scpi_app_host_pump(4);

		if (++tick >= 10) {
			tick = 0;
			network_status_periodical();
		}
    }
}

extern temp_pid_coef_t temp_coef;

extern "C" void microtask_handler() {
	// RESET ESP32 and boot from flash
	// Do it here as HAL_Delay requires the RTOS to be running
	HAL_GPIO_WritePin(ESP_EN_GPIO_Port, ESP_EN_Pin, GPIO_PIN_RESET);

	HAL_GPIO_WritePin(ESP_BOOT_GPIO_Port, ESP_BOOT_Pin, GPIO_PIN_SET);
	HAL_GPIO_WritePin(ESP_GP8_GPIO_Port, ESP_GP8_Pin, GPIO_PIN_SET);
	HAL_GPIO_WritePin(ESP_GP2_GPIO_Port, ESP_GP2_Pin, GPIO_PIN_SET);

	HAL_Delay(75); // Minimum 50 ms for esp32 reset

	HAL_GPIO_WritePin(ESP_EN_GPIO_Port, ESP_EN_Pin, GPIO_PIN_SET);

	esp_io_ping();

	esp_io_get_provision_status((uint8_t*)&provision_status);

	if (provision_status == 0) {
		tui_render_provision();
		for(;;) {
			vTaskDelay(1000);
		}
	}

	{
		// device serial for *IDN? (empty → STM32 UID fallback inside scpi_app)
		char serial[35];
		esp_io_get_serial(serial);
		scpi_app_set_serial(serial);
	}

	esp_io_get_settings((bool*)&buzzer, (bool*)&wifi);

	esp_io_get_calibration(
		&temp_coef.Kp,
		&temp_coef.Ti,
		&temp_coef.Td,
		&temp_coef.Tf,
		&temp_coef.Kb
	);

	scheduler.scheduler_loop();
}

extern "C" { extern osThreadId_t controlHandle; }

extern "C" void control_interrupt() {
	osThreadFlagsSet(controlHandle, 0x00000001);
}

extern "C" void control_handler() {
    for (;;)
    {
        osThreadFlagsWait(0x00000001, osFlagsWaitAny, osWaitForever);
        control_1ms_step();
    }
}

extern "C" int molstem_before_kernel_start()
{
	drivers_init();

	control_init();

	scpi_app_init();

	// queue initial microtasks
	scheduler.queue_task(ui_task());
	scheduler.queue_task(renderer_task());

	return 1;
}
