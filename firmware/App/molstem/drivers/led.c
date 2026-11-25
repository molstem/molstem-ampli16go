/*
 * buzzer.c
 *
 *  Created on: Jan 19, 2025
 *      Author: sebas
 */

#include "led.h"
#include "gpio.h"
#include "cmsis_os.h"


void led_red_state(int red) {
	if (red) {
		HAL_GPIO_WritePin(LED_RED_GPIO_Port, LED_RED_Pin, GPIO_PIN_SET);
	} else {
		HAL_GPIO_WritePin(LED_RED_GPIO_Port, LED_RED_Pin, GPIO_PIN_RESET);
	}
}

void led_green_state(int green) {
	if (green) {
		HAL_GPIO_WritePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin, GPIO_PIN_SET);
	} else {
		HAL_GPIO_WritePin(LED_GREEN_GPIO_Port, LED_GREEN_Pin, GPIO_PIN_RESET);
	}
}

void led_blue_state(int blue) {
	if (blue) {
		HAL_GPIO_WritePin(LED_BLUE_GPIO_Port, LED_BLUE_Pin, GPIO_PIN_SET);
	} else {
		HAL_GPIO_WritePin(LED_BLUE_GPIO_Port, LED_BLUE_Pin, GPIO_PIN_RESET);
	}
}

void led(int red, int green, int blue) {
	led_red_state(red);
	led_green_state(green);
	led_blue_state(blue);
}
