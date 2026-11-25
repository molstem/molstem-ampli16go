/*
 * hbridge_control.c
 *
 *  Created on: May 16, 2025
 *      Author: Arash Noroozi
 */

/*
 * hbridge_control.c - Corrected Implementation
 * Based on Renesas RX23E-A Complementary PWM Control
 *
 * Hardware Mapping:
 * A(PB1)  -> TIM1_CH3N  (Heating path)
 * B(PA10) -> TIM1_CH3   (Cooling path)
 * C(PA9)  -> TIM1_CH2   (Cooling path)
 * D(PB14) -> TIM1_CH2N  (Heating path)
 *
 * Control Logic:
 * - Bridge Voltage 1: TIM1_CH3 pair (A/B)
 * - Bridge Voltage 2: TIM1_CH2 pair (C/D)
 * - Heating: A+D active (CH3N high, CH2N high)
 * - Cooling: B+C active (CH3 high, CH2 high)
 */

#include <math.h>
#include "hbridge_control.h"
#include "tim.h"
#include "cmsis_os.h"

static bridge_state_t current_state = BRIDGE_IDLE;
static uint32_t transition_start_time = 0;

void hbridge_init(void)
{
    // Start both complementary PWM channel pairs
    // TIM1_CH2 and TIM1_CH2N (C and D)
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_2);      // C (PA9)
    HAL_TIMEx_PWMN_Start(&htim1, TIM_CHANNEL_2);   // D (PB14)

    // TIM1_CH3 and TIM1_CH3N (B and A)
    HAL_TIM_PWM_Start(&htim1, TIM_CHANNEL_3);      // B (PA10)
    HAL_TIMEx_PWMN_Start(&htim1, TIM_CHANNEL_3);   // A (PB1)

    // Set initial duty cycle to 50% (no differential voltage)
    // This creates idle state with no current flow
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_2, PWM_PERIOD / 2);  // Bridge2 (C/D) = 50%
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_3, PWM_PERIOD / 2);  // Bridge1 (A/B) = 50%

    // Until now the pins were plain GPIO driven low (see HAL_TIM_MspPostInit) so
    // the gate-driver inputs could not float up; hand them to the timer only
    // now that its outputs are enabled and driving.
    hbridge_pins_to_timer();

    current_state = BRIDGE_IDLE;
}

bridge_state_t hbridge_update(float duty_cycle)
{
    bridge_state_t target_state;
    uint16_t pwm_ch2, pwm_ch3;  // CH2 controls C/D, CH3 controls A/B

    // Determine target state based on duty cycle
    if (fabsf(duty_cycle) < 0.01f) {
        target_state = BRIDGE_IDLE;
    } else if (duty_cycle > 0) {
        target_state = BRIDGE_HEATING;
    } else {
        target_state = BRIDGE_COOLING;
    }

    // MODIFIED: Only add delay for large transitions, not small ones
    if (target_state != current_state && current_state != BRIDGE_TRANSITIONING) {
        
        // Only use transition delay for large duty cycles (risk of shoot-through)
        if (fabsf(duty_cycle) > 0.5f) {  // Only delay for large changes
            __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_2, PWM_PERIOD / 2);
            __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_3, PWM_PERIOD / 2);
            
            transition_start_time = HAL_GetTick();
            current_state = BRIDGE_TRANSITIONING;
            
            //vTaskDelay(pdMS_TO_TICKS(PWM_TRANSITION_DELAY_MS));
            //current_state = target_state;
        } else {
            // For small duty cycles, switch immediately without delay
            current_state = target_state;
        }
    }

    // Check if transition is complete
    if (current_state == BRIDGE_TRANSITIONING) {
        if ((HAL_GetTick() - transition_start_time) >= PWM_TRANSITION_DELAY_MS) {
            current_state = target_state;
        } else {
            return current_state;
        }
    }

    // Limit duty cycle to safe operating range
    float duty_limited = fmaxf(fminf(duty_cycle, PWM_DUTY_MAX), PWM_DUTY_MIN);
    float abs_duty = fabsf(duty_limited);

    // Calculate PWM values - KEY INSIGHT: Use same duty on both channels
    // to leverage complementary PWM hardware for diagonal switching
    switch (current_state) {
        case BRIDGE_HEATING:
            // Heating: A+D active (CH3N + CH2N both high)
            // Both channels low duty -> Both complementary outputs high
            pwm_ch3 = (uint16_t)(PWM_PERIOD * (0.5f - abs_duty / 2.0f));  // Low duty
            pwm_ch2 = (uint16_t)(PWM_PERIOD * (0.5f - abs_duty / 2.0f));  // Same low duty
            break;

        case BRIDGE_COOLING:
            // Cooling: B+C active (CH3 + CH2 both high)
            // Both channels high duty -> Both main outputs high
            pwm_ch3 = (uint16_t)(PWM_PERIOD * (0.5f + abs_duty / 2.0f));  // High duty
            pwm_ch2 = (uint16_t)(PWM_PERIOD * (0.5f + abs_duty / 2.0f));  // Same high duty
            break;

        case BRIDGE_IDLE:
        default:
            // Both bridges at 50% - no differential voltage, no current flow
            pwm_ch3 = PWM_PERIOD / 2;  // Bridge1 = 50%
            pwm_ch2 = PWM_PERIOD / 2;  // Bridge2 = 50%
            break;
    }

    // Ensure PWM values are within valid range
    if (pwm_ch2 > PWM_PERIOD) pwm_ch2 = PWM_PERIOD;
    if (pwm_ch3 > PWM_PERIOD) pwm_ch3 = PWM_PERIOD;
    if (pwm_ch2 < 0) pwm_ch2 = 0;
    if (pwm_ch3 < 0) pwm_ch3 = 0;

    // Apply PWM values to control bridge voltages
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_2, pwm_ch2);  // Bridge2 (C/D pair)
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_3, pwm_ch3);  // Bridge1 (A/B pair)

    return current_state;
}

void hbridge_shutdown(void)
{
    // Set both bridges to 50% (safe idle state)
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_2, PWM_PERIOD / 2);
    __HAL_TIM_SET_COMPARE(&htim1, TIM_CHANNEL_3, PWM_PERIOD / 2);

    current_state = BRIDGE_IDLE;
}

bridge_state_t hbridge_get_state(void)
{
    return current_state;
}

float voltage_to_duty(float voltage, float bridge_voltage)
{
    // Convert voltage command to duty cycle
    float duty = voltage / bridge_voltage;

    // Limit duty cycle to valid range
    return fmaxf(fminf(duty, PWM_DUTY_MAX), PWM_DUTY_MIN);
}
