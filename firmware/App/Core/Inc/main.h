/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file.
  *                   This file contains the common defines of the application.
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

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f4xx_hal.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */
#include "FreeRTOS.h"
#include "task.h"
#include "cmsis_os.h"
/* USER CODE END Includes */

/* Exported types ------------------------------------------------------------*/
/* USER CODE BEGIN ET */
#define SD_SPI_HANDLE hspi1

/* USER CODE END ET */

/* Exported constants --------------------------------------------------------*/
/* USER CODE BEGIN EC */

/* USER CODE END EC */

/* Exported macro ------------------------------------------------------------*/
/* USER CODE BEGIN EM */

/* USER CODE END EM */

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */

/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define Current_LID_Pin GPIO_PIN_0
#define Current_LID_GPIO_Port GPIOC
#define TEMP_PLT_Pin GPIO_PIN_1
#define TEMP_PLT_GPIO_Port GPIOC
#define ADC_LID_2_Pin GPIO_PIN_2
#define ADC_LID_2_GPIO_Port GPIOC
#define ADC_PLT_2_Pin GPIO_PIN_3
#define ADC_PLT_2_GPIO_Port GPIOC
#define Current_PLT_Pin GPIO_PIN_0
#define Current_PLT_GPIO_Port GPIOA
#define Temp_LID_Pin GPIO_PIN_1
#define Temp_LID_GPIO_Port GPIOA
#define STM_TX_ESP_RX_Pin GPIO_PIN_2
#define STM_TX_ESP_RX_GPIO_Port GPIOA
#define STM_RX_ESP_TX_Pin GPIO_PIN_3
#define STM_RX_ESP_TX_GPIO_Port GPIOA
#define ENC_BTN_Pin GPIO_PIN_4
#define ENC_BTN_GPIO_Port GPIOA
#define ENC_BTN_EXTI_IRQn EXTI4_IRQn
#define LCD_D4_Pin GPIO_PIN_4
#define LCD_D4_GPIO_Port GPIOC
#define LCD_D5_Pin GPIO_PIN_5
#define LCD_D5_GPIO_Port GPIOC
#define LID_HEAT_Pin GPIO_PIN_0
#define LID_HEAT_GPIO_Port GPIOB
#define PLTR_A_Pin GPIO_PIN_1
#define PLTR_A_GPIO_Port GPIOB
#define SPI1_CS_Pin GPIO_PIN_10
#define SPI1_CS_GPIO_Port GPIOB
#define LED_BLUE_Pin GPIO_PIN_12
#define LED_BLUE_GPIO_Port GPIOB
#define LED_RED_Pin GPIO_PIN_13
#define LED_RED_GPIO_Port GPIOB
#define PLTR_D_Pin GPIO_PIN_14
#define PLTR_D_GPIO_Port GPIOB
#define ESP_EN_Pin GPIO_PIN_15
#define ESP_EN_GPIO_Port GPIOB
#define LCD_D6_Pin GPIO_PIN_6
#define LCD_D6_GPIO_Port GPIOC
#define LCD_D7_Pin GPIO_PIN_7
#define LCD_D7_GPIO_Port GPIOC
#define LCD_K_Pin GPIO_PIN_8
#define LCD_K_GPIO_Port GPIOC
#define SDA_RTC_Pin GPIO_PIN_9
#define SDA_RTC_GPIO_Port GPIOC
#define SCL_RTC_Pin GPIO_PIN_8
#define SCL_RTC_GPIO_Port GPIOA
#define PLTR_C_Pin GPIO_PIN_9
#define PLTR_C_GPIO_Port GPIOA
#define PLTR_B_Pin GPIO_PIN_10
#define PLTR_B_GPIO_Port GPIOA
#define INT_RTC_Pin GPIO_PIN_15
#define INT_RTC_GPIO_Port GPIOA
#define LCD_RS_Pin GPIO_PIN_10
#define LCD_RS_GPIO_Port GPIOC
#define LED_GREEN_Pin GPIO_PIN_11
#define LED_GREEN_GPIO_Port GPIOC
#define LCD_EN_Pin GPIO_PIN_12
#define LCD_EN_GPIO_Port GPIOC
#define ENC_DT_Pin GPIO_PIN_2
#define ENC_DT_GPIO_Port GPIOD
#define ENC_DT_EXTI_IRQn EXTI2_IRQn
#define ENC_CLK_Pin GPIO_PIN_3
#define ENC_CLK_GPIO_Port GPIOB
#define ENC_CLK_EXTI_IRQn EXTI3_IRQn
#define FAN_Pin GPIO_PIN_4
#define FAN_GPIO_Port GPIOB
#define BUZZER_Pin GPIO_PIN_5
#define BUZZER_GPIO_Port GPIOB
#define ESP_GP8_Pin GPIO_PIN_6
#define ESP_GP8_GPIO_Port GPIOB
#define ESP_GP2_Pin GPIO_PIN_7
#define ESP_GP2_GPIO_Port GPIOB
#define LID_SW_Pin GPIO_PIN_8
#define LID_SW_GPIO_Port GPIOB
#define ESP_BOOT_Pin GPIO_PIN_9
#define ESP_BOOT_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
