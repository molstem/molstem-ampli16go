/*
 * current_limiter_pi.c
 *
 *  Created on: Mar 6, 2025
 *      Author: sebas
 *  Updated on: May 16, 2025
 *      Author: Arash Noroozi
 */

/* current_limiter_pi.c */
#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include "current_limiter_pi.h"
void current_pi_init(current_pi_coef_t *coef, current_pi_data_t *data)
{
    // Set default coefficients based on Renesas reference
    coef->Kp = CURRENT_CONTROL_KP;
    coef->Ti = CURRENT_CONTROL_TI;
    coef->Kb = CURRENT_CONTROL_KB;
    coef->dt = CURRENT_CONTROL_CYCLE_MS / 1000.0f;  // Convert ms to s
    coef->vc_min = VOLTAGE_MIN;
    coef->vc_max = VOLTAGE_MAX;

    // Initialize internal state
    data->Ie_prev = 0.0f;
    data->Ie_i = 0.0f;
    data->Vc_prev = 0.0f;
}

float current_pi_control(float target_current, float measured_current,
                        current_pi_coef_t *coef, current_pi_data_t *data)
{
    // Calculate current error
    float Ie = target_current - measured_current;

    // Tustin integration method for PI controller
    // Update integral term with trapezoidal integration
    data->Ie_i += 0.5f * (Ie + data->Ie_prev) * coef->dt / coef->Ti;

    // Calculate PI output
    float Vpi = coef->Kp * (Ie + data->Ie_i);

    // Apply output limiting
    float Vc = fminf(fmaxf(Vpi, coef->vc_min), coef->vc_max);

    // Anti-windup: back-calculate to prevent integral windup
    if (Vpi != Vc) {
        // Adjust integral term based on output saturation
        data->Ie_i += coef->Kb * (Vc - Vpi) * coef->dt / coef->Ti;
    }

    // Store values for next iteration
    data->Ie_prev = Ie;
    data->Vc_prev = Vc;

    return Vc;
}
