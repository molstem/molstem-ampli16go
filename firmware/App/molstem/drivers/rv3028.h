/*
 * rv3028.h
 *
 *  Created on: Mar 26, 2025
 *      Author: tytooo
 */

#ifndef INC_RV3028_H_
#define INC_RV3028_H_

#include <stdbool.h>
#include "stm32f4xx_hal.h"

#define RV3028_ADDR         (0x52 << 1) // 7-bit address shifted for HAL

#define RV3028_SECONDS      0x00
#define RV3028_MINUTES      0x01
#define RV3028_HOURS        0x02
#define RV3028_WEEKDAY      0x03
#define RV3028_DATE         0x04
#define RV3028_MONTH        0x05
#define RV3028_YEAR         0x06

typedef struct {
    uint8_t seconds;
    uint8_t minutes;
    uint8_t hours;
    uint8_t weekday;
    uint8_t date;
    uint8_t month;
    uint8_t year;
} RV3028_Time;

void RV3028_Init(I2C_HandleTypeDef *hi2c);
HAL_StatusTypeDef RV3028_SetTime(RV3028_Time *time);
HAL_StatusTypeDef RV3028_GetTime(RV3028_Time *time);
void RV3028_ClearResetFlag(void);
bool RV3028_WasReset(void);

#endif /* INC_RV3028_H_ */
