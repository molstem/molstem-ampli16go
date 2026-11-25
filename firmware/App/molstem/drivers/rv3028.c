#include "rv3028.h"

static I2C_HandleTypeDef *rtc_i2c;

void RV3028_Init(I2C_HandleTypeDef *hi2c) {
    rtc_i2c = hi2c;
}

static uint8_t DECtoBCD(uint8_t val) {
    return ((val / 10) << 4) | (val % 10);
}

static uint8_t BCDtoDEC(uint8_t val) {
    return ((val >> 4) * 10) + (val & 0x0F);
}

HAL_StatusTypeDef RV3028_SetTime(RV3028_Time *time) {
    uint8_t data[7];
    data[0] = DECtoBCD(time->seconds);
    data[1] = DECtoBCD(time->minutes);
    data[2] = DECtoBCD(time->hours);
    data[3] = DECtoBCD(time->weekday);
    data[4] = DECtoBCD(time->date);
    data[5] = DECtoBCD(time->month);
    data[6] = DECtoBCD(time->year);

    return HAL_I2C_Mem_Write(rtc_i2c, RV3028_ADDR, RV3028_SECONDS, I2C_MEMADD_SIZE_8BIT, data, 7, HAL_MAX_DELAY);
}

bool RV3028_WasReset(void) {
    uint8_t status = 0;
    if (HAL_I2C_Mem_Read(rtc_i2c, RV3028_ADDR, 0x0E, I2C_MEMADD_SIZE_8BIT, &status, 1, HAL_MAX_DELAY) == HAL_OK) {
        return status & 0x01; // Bit 0 = PORF
    }
    return false;
}

void RV3028_ClearResetFlag(void) {
    uint8_t status = 0;
    if (HAL_I2C_Mem_Read(rtc_i2c, RV3028_ADDR, 0x0E, I2C_MEMADD_SIZE_8BIT, &status, 1, HAL_MAX_DELAY) == HAL_OK) {
        status &= ~0x01;
        HAL_I2C_Mem_Write(rtc_i2c, RV3028_ADDR, 0x0E, I2C_MEMADD_SIZE_8BIT, &status, 1, HAL_MAX_DELAY);
    }
}


HAL_StatusTypeDef RV3028_GetTime(RV3028_Time *time) {
    uint8_t data[7];
    HAL_StatusTypeDef res = HAL_I2C_Mem_Read(rtc_i2c, RV3028_ADDR, RV3028_SECONDS, I2C_MEMADD_SIZE_8BIT, data, 7, HAL_MAX_DELAY);

    if (res != HAL_OK) return res;

    time->seconds = BCDtoDEC(data[0]);
    time->minutes = BCDtoDEC(data[1]);
    time->hours   = BCDtoDEC(data[2]);
    time->weekday = BCDtoDEC(data[3]);
    time->date    = BCDtoDEC(data[4]);
    time->month   = BCDtoDEC(data[5]);
    time->year    = BCDtoDEC(data[6]);

    return HAL_OK;
}
