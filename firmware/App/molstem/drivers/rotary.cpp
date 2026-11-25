#include <cstdlib>

#include "rotary.hpp"
#include "gpio.h"

volatile int32_t encoder_position = 0;
volatile uint8_t encoder_button_state = 0;
volatile uint32_t encoder_button_last_press_time = 0;
volatile uint8_t encoder_last_state = 0;
volatile int32_t encoder_counter = 0;

/* Private application code --------------------------------------------------*/
/* USER CODE BEGIN Application */
void rotary_init() {
    uint8_t clk_state = HAL_GPIO_ReadPin(ENC_CLK_GPIO_Port, ENC_CLK_Pin);
    uint8_t dt_state = HAL_GPIO_ReadPin(ENC_DT_GPIO_Port, ENC_DT_Pin);
    encoder_last_state = (clk_state << 1) | dt_state;
}

void HAL_GPIO_EXTI_Callback(uint16_t GPIO_Pin)
{
    // Handle button press
    if (GPIO_Pin == ENC_BTN_Pin) {
    	encoder_button_state = HAL_GPIO_ReadPin(ENC_BTN_GPIO_Port, ENC_BTN_Pin) == GPIO_PIN_RESET;
    	encoder_button_last_press_time = HAL_GetTick();
    }
    // Handle encoder rotation
    else if (GPIO_Pin == ENC_CLK_Pin || GPIO_Pin == ENC_DT_Pin)
    {
        // Read both encoder pins
        uint8_t clk_state = HAL_GPIO_ReadPin(ENC_CLK_GPIO_Port, ENC_CLK_Pin);
        uint8_t dt_state = HAL_GPIO_ReadPin(ENC_DT_GPIO_Port, ENC_DT_Pin);

        // Create current state value
        uint8_t current_state = (clk_state << 1) | dt_state;

        // State machine for quadrature decoding
        static const int8_t encoder_table[16] = {
             0,  // 0000: no change
             1,  // 0001: CCW
            -1,  // 0010: CW
             0,  // 0011: error
            -1,  // 0100: CW
             0,  // 0101: no change
             0,  // 0110: error
             1,  // 0111: CCW
             1,  // 1000: CCW
             0,  // 1001: error
             0,  // 1010: no change
            -1,  // 1011: CW
             0,  // 1100: error
            -1,  // 1101: CW
             1,  // 1110: CCW
             0   // 1111: no change
        };

        // Combine last state and current state
        uint8_t combined = (encoder_last_state << 2) | current_state;
        int8_t increment = encoder_table[combined & 0x0F];


        if (increment != 0) {
        	static uint32_t last_press_time = 0;
        	static int32_t increment_counter = 0;
        	if (HAL_GetTick() - last_press_time > 200) {
				increment_counter += increment;


				if (abs(increment_counter) >= 3) {
					encoder_counter += increment_counter > 0 ? -1 : 1;
					increment_counter = 0;
					last_press_time = HAL_GetTick();
				}
        	}
        }

        encoder_last_state = current_state;
    }
}
