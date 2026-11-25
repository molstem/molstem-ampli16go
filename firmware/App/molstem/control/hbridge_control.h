/*
 * hbridge_control.h
 *
 *  Created on: May 16, 2025
 *      Author: Arash Noroozi
 */

/*
 * hbridge_control.h - Corrected Implementation
 * Based on Renesas RX23E-A Complementary PWM Control
 *
 * Hardware Configuration:
 * A(PB1)  -> TIM1_CH3N  (Heating path - complementary to B)
 * B(PA10) -> TIM1_CH3   (Cooling path - complementary to A)
 * C(PA9)  -> TIM1_CH2   (Cooling path - complementary to D)
 * D(PB14) -> TIM1_CH2N  (Heating path - complementary to C)
 *
 * Control Strategy:
 * - Uses two complementary PWM pairs to create two bridge voltages
 * - Current flow controlled by voltage difference between bridges
 * - Heating: A+D path active (Bridge2 > Bridge1)
 * - Cooling: B+C path active (Bridge1 > Bridge2)
 * - 100ms transition delay between mode changes for safety
 */

#ifndef INC_HBRIDGE_CONTROL_H_
#define INC_HBRIDGE_CONTROL_H_

#include <stdint.h>
#include <stdbool.h>
#include "control_parameters.h"

// Bridge state enumeration
typedef enum {
    BRIDGE_IDLE,            // No current flow (both bridges at 50%)
    BRIDGE_HEATING,         // Heating mode (A+D path active)
    BRIDGE_COOLING,         // Cooling mode (B+C path active)
    BRIDGE_TRANSITIONING    // Safety transition state
} bridge_state_t;

// Function prototypes

/**
 * @brief Initialize the H-bridge PWM channels and set to idle state
 *
 * Configures TIM1_CH2/CH2N and TIM1_CH3/CH3N for complementary PWM operation
 * Sets initial duty cycles to 50% for safe idle state with no current flow
 */
void hbridge_init(void);

/**
 * @brief Update H-bridge PWM duty cycle based on the command
 *
 * @param duty_cycle: Control command (-0.9 to +0.9)
 *                   Positive values = heating mode (A+D active)
 *                   Negative values = cooling mode (B+C active)
 *                   Values near 0 = idle mode
 *
 * @return Current bridge state after update
 *
 * Note: Includes 100ms safety transition delay when switching between
 *       heating and cooling modes to prevent shoot-through
 */
bridge_state_t hbridge_update(float duty_cycle);

/**
 * @brief Shutdown H-bridge (set to safe idle mode)
 *
 * Sets both bridge voltages to 50% duty cycle, ensuring no current flow
 * and safe state for system shutdown or emergency stop
 */
void hbridge_shutdown(void);

/**
 * @brief Get current bridge state
 *
 * @return Current operating state of the H-bridge
 */
bridge_state_t hbridge_get_state(void);

/**
 * @brief Convert voltage command to duty cycle
 *
 * @param voltage: Desired voltage across Peltier module
 * @param bridge_voltage: Available bridge supply voltage
 * @return Duty cycle value limited to safe operating range
 *
 * Helper function to convert voltage commands from temperature controller
 * to appropriate duty cycle values for PWM control
 */
float voltage_to_duty(float voltage, float bridge_voltage);

#endif /* INC_HBRIDGE_CONTROL_H_ */
