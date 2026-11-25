/*
 * current_limiter_pi.h
 *
 *  Created on: Mar 6, 2025
 *      Author: sebas
 *  Updated on: May 16, 2025
 *      Author: Arash Noroozi
 */

/* current_limiter_pi.h */
#ifndef INC_CURRENT_LIMITER_PI_H_
#define INC_CURRENT_LIMITER_PI_H_

#include <stdint.h>
#include <stdbool.h>
#include "control_parameters.h"

typedef struct {
    float Kp;        // Proportional gain
    float Ti;        // Integral time
    float Kb;        // Anti-windup gain
    float dt;        // Control cycle time
    float vc_min;    // Minimum voltage command
    float vc_max;    // Maximum voltage command
} current_pi_coef_t;

typedef struct {
    float Ie_prev;    // Previous current error
    float Ie_i;       // Integral term
    float Vc_prev;    // Previous voltage command
} current_pi_data_t;

// Initialize current PI controller with default parameters
void current_pi_init(current_pi_coef_t *coef, current_pi_data_t *data);

// Calculate voltage command from current error
float current_pi_control(float target_current, float measured_current,
                         current_pi_coef_t *coef, current_pi_data_t *data);

#endif /* INC_CURRENT_LIMITER_PI_H_ */
