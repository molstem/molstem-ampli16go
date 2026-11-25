/*
 * fan.c
 *
 *  Created on: Mar 20, 2025
 *      Author: sebas
 */


#include "fan.h"
#include "gpio.h"


void fan_enable(void)
{
	HAL_GPIO_WritePin(FAN_GPIO_Port, FAN_Pin, GPIO_PIN_SET);
}

void fan_disable(void)
{
	HAL_GPIO_WritePin(FAN_GPIO_Port, FAN_Pin, GPIO_PIN_RESET);
}
