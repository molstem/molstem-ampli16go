/*
 * buzzer.c
 *
 *  Created on: Jan 19, 2025
 *      Author: sebas
 */

#include "buzzer.h"
#include "gpio.h"
#include "cmsis_os.h"


void buzzer_beep(uint32_t ms) {
	HAL_GPIO_WritePin(BUZZER_GPIO_Port, BUZZER_Pin, GPIO_PIN_SET);
	vTaskDelay(pdMS_TO_TICKS(ms));
	HAL_GPIO_WritePin(BUZZER_GPIO_Port, BUZZER_Pin, GPIO_PIN_RESET);
}

void buzzer_beep_state(int beep) {
	if (beep) {
		HAL_GPIO_WritePin(BUZZER_GPIO_Port, BUZZER_Pin, GPIO_PIN_SET);
	} else {
		HAL_GPIO_WritePin(BUZZER_GPIO_Port, BUZZER_Pin, GPIO_PIN_RESET);
	}
}
