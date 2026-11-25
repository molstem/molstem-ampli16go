/*
 * temp_control_pid.h
 *
 *  Created on: Mar 6, 2025
 *      Author: sebas
 *  Updated on: May 16, 2025
 *      Author: Arash Noroozi
 */

/* temp_control_pid.h */
#ifndef INC_TEMP_CONTROL_PID_H_
#define INC_TEMP_CONTROL_PID_H_

#include <stdint.h>
#include <stdbool.h>
#include "control_parameters.h"

typedef struct {
    float Kp;        // Proportional gain
    float Ti;        // Integral time
    float Td;        // Derivative time
    float Tf;        // Derivative filter time
    float Kb;        // Anti-windup gain
    float dt;        // Control cycle time
    float ic_min;    // Minimum current command
    float ic_max;    // Maximum current command
} temp_pid_coef_t;

typedef struct {
    float Te_prev;    // Previous temperature error
    float Te_i_prev;  // Previous temperature error (I term)
    float Te_d_prev;  // Previous derivative term
    float Te_i;       // Integral term
    float Ic_prev;    // Previous controller output

    // Debug: last computed contributions (in current units)
    float last_p;     // Kp * Te
    float last_i;     // Kp * Te_i
    float last_d;     // Kp * Te_d
} temp_pid_data_t;

// Initialize temperature PID controller with default parameters
void temp_pid_init(temp_pid_coef_t *coef, temp_pid_data_t *data);

// Calculate current setpoint from temperature error
float temp_pid_control(float target_temp, float measured_temp, float predicted_temp, temp_pid_coef_t *coef, temp_pid_data_t *data);

#endif /* INC_TEMP_CONTROL_PID_H_ */
