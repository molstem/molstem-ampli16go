/*
 * buzzer.h
 *
 *  Created on: Jan 19, 2025
 *      Author: sebas
 */

#pragma once

#include <stdint.h>

void led_red_state(int red);
void led_green_state(int green);
void led_blue_state(int blue);
void led(int red, int green, int blue);
