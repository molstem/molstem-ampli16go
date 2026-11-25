/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * File Name          : freertos.c
  * Description        : Code for freertos applications
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2025 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */
/* USER CODE END Header */

/* Includes ------------------------------------------------------------------*/
#include "FreeRTOS.h"
#include "task.h"
#include "main.h"
#include "cmsis_os.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
/* USER CODE BEGIN Variables */

/* USER CODE END Variables */
/* Definitions for microscheduler */
osThreadId_t microschedulerHandle;
const osThreadAttr_t microscheduler_attributes = {
  .name = "microscheduler",
  .stack_size = 2048 * 4,
  .priority = (osPriority_t) osPriorityAboveNormal,
};
/* Definitions for usb_logging */
osThreadId_t usb_loggingHandle;
const osThreadAttr_t usb_logging_attributes = {
  .name = "usb_logging",
  .stack_size = 2048 * 4,
  .priority = (osPriority_t) osPriorityLow,
};
/* Definitions for control */
osThreadId_t controlHandle;
const osThreadAttr_t control_attributes = {
  .name = "control",
  .stack_size = 1024 * 4,
  .priority = (osPriority_t) osPriorityRealtime7,
};
/* Definitions for uart_bridge */
osThreadId_t uart_bridgeHandle;
const osThreadAttr_t uart_bridge_attributes = {
  .name = "uart_bridge",
  .stack_size = 1024 * 4,
  .priority = (osPriority_t) osPriorityLow,
};
/* Definitions for esp_tx */
osThreadId_t esp_txHandle;
const osThreadAttr_t esp_tx_attributes = {
  .name = "esp_tx",
  .stack_size = 128 * 4,
  .priority = (osPriority_t) osPriorityLow,
};
/* Definitions for esp_io */
osMutexId_t esp_ioHandle;
const osMutexAttr_t esp_io_attributes = {
  .name = "esp_io"
};
/* Definitions for esp_rx_ackd */
osSemaphoreId_t esp_rx_ackdHandle;
const osSemaphoreAttr_t esp_rx_ackd_attributes = {
  .name = "esp_rx_ackd"
};
/* Definitions for esp_tx_rdy */
osSemaphoreId_t esp_tx_rdyHandle;
const osSemaphoreAttr_t esp_tx_rdy_attributes = {
  .name = "esp_tx_rdy"
};
/* Definitions for esp_rx_rcvd */
osSemaphoreId_t esp_rx_rcvdHandle;
const osSemaphoreAttr_t esp_rx_rcvd_attributes = {
  .name = "esp_rx_rcvd"
};

/* Private function prototypes -----------------------------------------------*/
/* USER CODE BEGIN FunctionPrototypes */

/* USER CODE END FunctionPrototypes */

void microscheduler_task(void *argument);
void usb_logging_task(void *argument);
void control_task(void *argument);
void uart_bridge_task(void *argument);
void esp_tx_task(void *argument);

extern void MX_USB_DEVICE_Init(void);
void MX_FREERTOS_Init(void); /* (MISRA C 2004 rule 8.1) */

/**
  * @brief  FreeRTOS initialization
  * @param  None
  * @retval None
  */
void MX_FREERTOS_Init(void) {
  /* USER CODE BEGIN Init */

  /* USER CODE END Init */
  /* Create the mutex(es) */
  /* creation of esp_io */
  esp_ioHandle = osMutexNew(&esp_io_attributes);

  /* USER CODE BEGIN RTOS_MUTEX */
  /* add mutexes, ... */
  /* USER CODE END RTOS_MUTEX */

  /* Create the semaphores(s) */
  /* creation of esp_rx_ackd */
  esp_rx_ackdHandle = osSemaphoreNew(1, 0, &esp_rx_ackd_attributes);

  /* creation of esp_tx_rdy */
  esp_tx_rdyHandle = osSemaphoreNew(1, 0, &esp_tx_rdy_attributes);

  /* creation of esp_rx_rcvd */
  esp_rx_rcvdHandle = osSemaphoreNew(1, 0, &esp_rx_rcvd_attributes);

  /* USER CODE BEGIN RTOS_SEMAPHORES */
  /* add semaphores, ... */
  /* USER CODE END RTOS_SEMAPHORES */

  /* USER CODE BEGIN RTOS_TIMERS */
  /* start timers, add new ones, ... */
  /* USER CODE END RTOS_TIMERS */

  /* USER CODE BEGIN RTOS_QUEUES */
  /* add queues, ... */
  /* USER CODE END RTOS_QUEUES */

  /* Create the thread(s) */
  /* creation of microscheduler */
  microschedulerHandle = osThreadNew(microscheduler_task, NULL, &microscheduler_attributes);

  /* creation of usb_logging */
  usb_loggingHandle = osThreadNew(usb_logging_task, NULL, &usb_logging_attributes);

  /* creation of control */
  controlHandle = osThreadNew(control_task, NULL, &control_attributes);

  /* creation of uart_bridge */
  uart_bridgeHandle = osThreadNew(uart_bridge_task, NULL, &uart_bridge_attributes);

  /* creation of esp_tx */
  esp_txHandle = osThreadNew(esp_tx_task, NULL, &esp_tx_attributes);

  /* USER CODE BEGIN RTOS_THREADS */
  /* add threads, ... */
  /* USER CODE END RTOS_THREADS */

  /* USER CODE BEGIN RTOS_EVENTS */
  /* add events, ... */
  /* USER CODE END RTOS_EVENTS */

}

/* USER CODE BEGIN Header_microscheduler_task */
/**
  * @brief  Function implementing the microscheduler thread.
  * @param  argument: Not used
  * @retval None
  */
/* USER CODE END Header_microscheduler_task */
void microscheduler_task(void *argument)
{
  /* init code for USB_DEVICE */
  MX_USB_DEVICE_Init();
  /* USER CODE BEGIN microscheduler_task */
  void microtask_handler();
  microtask_handler();
  vTaskDelete( NULL );
  /* USER CODE END microscheduler_task */
}

/* USER CODE BEGIN Header_usb_logging_task */
/**
* @brief Function implementing the usb_logging thread.
* @param argument: Not used
* @retval None
*/
/* USER CODE END Header_usb_logging_task */
void usb_logging_task(void *argument)
{
  /* USER CODE BEGIN usb_logging_task */
	void usb_logging_handler();
	usb_logging_handler();
	vTaskDelete( NULL );
  /* USER CODE END usb_logging_task */
}

/* USER CODE BEGIN Header_control_task */
/**
* @brief Function implementing the control thread.
* @param argument: Not used
* @retval None
*/
/* USER CODE END Header_control_task */
void control_task(void *argument)
{
  /* USER CODE BEGIN control_task */
  /* Infinite loop */
	void control_handler();
	control_handler();
	vTaskDelete( NULL );
  /* USER CODE END control_task */
}

/* USER CODE BEGIN Header_uart_bridge_task */
/**
* @brief Function implementing the uart_bridge_tas thread.
* @param argument: Not used
* @retval None
*/
/* USER CODE END Header_uart_bridge_task */
void uart_bridge_task(void *argument)
{
  /* USER CODE BEGIN uart_bridge_task */
  extern void uart_bridge_handler();
  uart_bridge_handler();
  vTaskDelete( NULL );
  /* USER CODE END uart_bridge_task */
}

/* USER CODE BEGIN Header_esp_tx_task */
/**
* @brief Function implementing the esp_tx thread.
* @param argument: Not used
* @retval None
*/
/* USER CODE END Header_esp_tx_task */
void esp_tx_task(void *argument)
{
  /* USER CODE BEGIN esp_tx_task */
  /* Infinite loop */
  extern void esp_tx_handler();
  esp_tx_handler();
  vTaskDelete( NULL );
  /* USER CODE END esp_tx_task */
}

/* Private application code --------------------------------------------------*/
/* USER CODE BEGIN Application */

/* USER CODE END Application */

