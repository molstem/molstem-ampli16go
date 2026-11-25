/*
 * control_parameters.h
 *
 *  Created on: May 16, 2025
 *      Author: Arash Noroozi
 */


/* control_parameters.h */
#ifndef INC_CONTROL_PARAMETERS_H_
#define INC_CONTROL_PARAMETERS_H_

#include <stdint.h>
#include <stdbool.h>

/* System constants */
#define BRIDGE_VOLTAGE				12.0f    // Bridge supply voltage in volts

/* Current control parameters */
#define CURRENT_CONTROL_CYCLE_MS	1.0f     // Current control cycle time in ms
#define CURRENT_CONTROL_KP			1.2f     // Current controller proportional gain
#define CURRENT_CONTROL_TI			0.0012f  // Current controller integral time constant
#define CURRENT_CONTROL_KB			0.8f     // Current controller anti-windup gain
#define CURRENT_MAX					4.0f     // Maximum current in amperes
#define CURRENT_MIN					-4.0f    // Minimum current in amperes
#define VOLTAGE_MAX					12.0f    // Maximum output voltage
#define VOLTAGE_MIN					-12.0f   // Minimum output voltage

#define CURRENT_DANGER				4.5f 	 // Auto shuts off the bridge

/* Temperature control parameters */
#define TEMP_CONTROL_CYCLE_MS		1.0f       // Temperature control cycle time in ms
#define TEMP_CONTROL_KP				1.740f     // Temperature controller proportional gain
#define TEMP_CONTROL_TI				6.010f     // Temperature controller integral time constant
#define TEMP_CONTROL_TD				1.010f     // Temperature controller derivative time constant
#define TEMP_CONTROL_TF				0.100f    // Temperature controller derivative filter time
#define TEMP_CONTROL_KB				0.810f     // Temperature controller anti-windup gain

/* PWM control parameters */
#define PWM_DUTY_MAX				0.99f     // Maximum PWM duty cycle
#define PWM_DUTY_MIN				-0.99f    // Minimum PWM duty cycle
#define PWM_PERIOD					999.0f    // Maximum PWM counter value
#define PWM_DEADTIME				50        // Deadtime in timer counts
#define PWM_FREQUENCY				24000     // 24kHz PWM frequency
#define PWM_TRANSITION_DELAY_MS		1         // Delay between mode transitions in ms

#endif /* INC_CONTROL_PARAMETERS_H_ */
