extern "C" {
	#include "tim.h"
	#include "i2c.h"
	#include "rv3028.h"
}

#include "rotary.hpp"

void drivers_init() {
	HAL_TIM_Base_Start_IT(&htim9);
	HAL_TIM_Base_Start_IT(&htim4);
	HAL_TIM_Base_Start_IT(&htim2);
	HAL_TIM_PWM_Init(&htim1);

	RV3028_Init(&hi2c3);
	rotary_init();
}
