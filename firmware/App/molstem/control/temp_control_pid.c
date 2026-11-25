/*
 * temp_control_pid.c
 *
 *  Created on: Mar 6, 2025
 *      Author: sebas
 *  Updated on: May 16, 2025
 *      Author: Arash Noroozi
 */

/* temp_control_pid.c */
#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include "temp_control_pid.h"

void temp_pid_init(temp_pid_coef_t *coef, temp_pid_data_t *data)
{
    // Set default coefficients based on Renesas reference
    coef->Kp = TEMP_CONTROL_KP;
    coef->Ti = TEMP_CONTROL_TI;
    coef->Td = TEMP_CONTROL_TD;
    coef->Tf = TEMP_CONTROL_TF;
    coef->Kb = TEMP_CONTROL_KB;
    coef->dt = TEMP_CONTROL_CYCLE_MS / 1000.0f;  // Convert ms to s
    coef->ic_min = CURRENT_MIN;
    coef->ic_max = CURRENT_MAX;

    // Initialize internal state
    data->Te_prev = 0.0f;
    data->Te_d_prev = 0.0f;
    data->Te_i = 0.0f;
    data->Ic_prev = 0.0f;
}

float temp_pid_control(float target_temp, float measured_temp, float predicted_temp, temp_pid_coef_t *coef, temp_pid_data_t *data)
{
    // Calculate temperature error
    float Te = target_temp - measured_temp;
    float Te_i = target_temp - predicted_temp;

    float dt = coef->dt;

    // Calculate derivative term with filter (lagged derivative)
    // Use formula: Td·de/dt / (1 + Tf·s)
    float alpha = coef->Tf / (coef->Tf + dt);
    float Te_d = alpha * data->Te_d_prev + (1.0f - alpha) * coef->Td * (Te - data->Te_prev) / dt;

    if (fabsf(Te_i) < 2.0f) {
		// Update integral term with Tustin's method (trapezoidal integration)
		data->Te_i += 0.5f * (Te + data->Te_prev) * dt / coef->Ti;
		// Delayed boost factor update
		data->Te_i_prev += 0.5f * (Te_i + data->Te_prev) * dt / coef->Ti;
    } else {
    	data->Te_i *= 0.95f;
    	data->Te_i_prev *= 0.95f;
    }

    if (fabsf(Te_i) < 0.25f) {
    	data->Te_i_prev *= 0.99f;
    }

    // Limit integral to prevent windup
    float max_integral = coef->ic_max / coef->Kp;
    if (data->Te_i > max_integral) data->Te_i = max_integral;
    if (data->Te_i < -max_integral) data->Te_i = -max_integral;


    // Calculate PID output (unscaled)
    float Ipid = coef->Kp * (Te + data->Te_i * 0.7f + data->Te_i_prev * 0.7f + Te_d) + 0.057f*predicted_temp - 2.8f;

    // Store individual contributions for debug/plotting
    data->last_p = coef->Kp * Te;
    data->last_i = coef->Kp * data->Te_i;
    data->last_d = coef->Kp * Te_d;

    // Apply asymmetric scaling to OUTPUT, not gains
    // Cooling is less effective due to Joule heating fighting Peltier
    if (Ipid < 0) {
        Ipid *= 1.5f;  // Increase cooling command
    }

    // Apply output limiting
    float Ic = fminf(fmaxf(Ipid, coef->ic_min), coef->ic_max);

    // Anti-windup: back-calculate to prevent integral windup
    if (Ipid != Ic) {
        data->Te_i += coef->Kb * (Ic - Ipid) * dt / coef->Ti;
    }

    // Store values for next iteration
    data->Te_prev = Te;

    data->Te_d_prev = Te_d;
    data->Ic_prev = Ic;

    return Ic;
}
