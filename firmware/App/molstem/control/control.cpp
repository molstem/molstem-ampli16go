#include <atomic>
#include <cmath>

#include "control.hpp"

extern "C" {
	#include "stm32f4xx_hal.h"
	#include "adc.h"
	#include "temp_control_pid.h"
	#include "current_limiter_pi.h"
	#include "hbridge_control.h"
	#include "drivers/current_measurement.h"
	#include "drivers/ntc.h"
	#include "drivers/fan.h"
	#include "control_parameters.h"
}

std::atomic<bool> control_ready;

std::atomic<unsigned> status_revision;
control_status_t current_status;

struct lid_temperature_smoother_t {
	bool first_sample = true;
	float filtered_value;
	float predicted_value; // linear projection 125 ms into the future

	void update(float new_sample) {
		float old_value = filtered_value;
		if (first_sample) {
			first_sample = false;
			predicted_value = filtered_value = new_sample;
		} else {
			filtered_value = 0.99f * filtered_value + 0.01f * new_sample;
			predicted_value = filtered_value + (filtered_value - old_value) * 125.0f;
		}
	}
};

struct plt_temperature_smoother_t {
	bool first_sample = true;
	float filtered_value;
	float predicted_value; // linear projection 125 ms into the future

	void update(float new_sample) {
		float old_value = filtered_value;
		if (first_sample) {
			first_sample = false;
			predicted_value = filtered_value = new_sample;
		} else {
			filtered_value = 0.99f * filtered_value + 0.01f * new_sample;
			predicted_value = filtered_value + (filtered_value - old_value) * 125.0f;
		}
	}
};

struct current_smoother_t {
	bool first_sample = true;
	float filtered_value;

	void update(float new_sample) {
		if (first_sample) {
			first_sample = false;
			filtered_value = new_sample;
		} else {
			filtered_value = 0.8f * filtered_value + 0.2f * new_sample;
		}
	}
};

struct control_state_t {
	current_smoother_t peltier_current;
	plt_temperature_smoother_t peltier_temperature;
	std::atomic<float> peltier_temperature_target = TARGET_DISABLED;
	bool peltier_control_enabled;
	float peltier_current_target;

	current_smoother_t lid_current;
	lid_temperature_smoother_t lid_temperature;
	std::atomic<float> lid_temperature_target = TARGET_DISABLED;

	float hbridge_voltage_target;
	float hbridge_duty_cycle;

	peak_detector_t peltier_peak_detector;
};

control_state_t current_state;
temp_pid_coef_t temp_coef;
temp_pid_data_t temp_data;
current_pi_coef_t current_coef;
current_pi_data_t current_data;
uint32_t control_tick_ms;

void control_init() {
	// initialize the various control structures

	// Initialize H-bridge
	hbridge_init();

	new (&current_state) control_state_t();

	temp_pid_init(&temp_coef, &temp_data);
	current_pi_init(&current_coef, &current_data);

	control_ready = true;
}

void control_lid_1ms_step() {
    const float TARGET_TEMP = current_state.lid_temperature_target;     // Target temperature
    const float HYSTERESIS = 0.2;//1.0f;        // Hysteresis band (±1°C)
    const float MAX_TEMP = 115.0f;        // Safety limit

    // Thresholds
    const float TURN_ON_BELOW = TARGET_TEMP - HYSTERESIS;   // Turn on at 104°C
    const float TURN_OFF_ABOVE = TARGET_TEMP + HYSTERESIS;  // Turn off at 106°C

    static unsigned backoff = 0;
    if (backoff > 0) {
    	HAL_GPIO_WritePin(LID_HEAT_GPIO_Port, LID_HEAT_Pin, GPIO_PIN_RESET);
    	backoff--;
    	return;
    }
    if (TARGET_TEMP == TARGET_DISABLED) {
    	HAL_GPIO_WritePin(LID_HEAT_GPIO_Port, LID_HEAT_Pin, GPIO_PIN_RESET);
    	return;
    }
    if (current_state.lid_temperature.predicted_value > MAX_TEMP) {
    	HAL_GPIO_WritePin(LID_HEAT_GPIO_Port, LID_HEAT_Pin, GPIO_PIN_RESET);
    	backoff = 100;
    } else if (current_state.lid_temperature.predicted_value <= TURN_ON_BELOW) {
		HAL_GPIO_WritePin(LID_HEAT_GPIO_Port, LID_HEAT_Pin, GPIO_PIN_SET);
	}
	else if (current_state.lid_temperature.predicted_value >= TURN_OFF_ABOVE) {
		HAL_GPIO_WritePin(LID_HEAT_GPIO_Port, LID_HEAT_Pin, GPIO_PIN_RESET);
	}
}




void control_peltier_1ms_step() {
    if (current_state.peltier_temperature_target != TARGET_DISABLED) {
		current_state.peltier_control_enabled = true;
    	current_state.peltier_current_target = temp_pid_control(current_state.peltier_temperature_target, current_state.peltier_temperature.filtered_value, current_state.peltier_temperature.predicted_value, &temp_coef, &temp_data);

    	if (current_state.peltier_current_target < 0) {
    		fan_enable();
    	} else {
    		fan_disable();
    	}
    } else {
    	fan_disable();
    	current_state.peltier_control_enabled = false;
    }

	if (current_state.peltier_temperature.filtered_value > 100.0f || current_state.peltier_temperature.filtered_value < -10.0f) {
        current_state.peltier_control_enabled = false;
    }

    if (!current_state.peltier_control_enabled) {
		current_data.Ie_prev = 0.0f;
		current_data.Ie_i = 0.0f;
		current_data.Vc_prev = 0.0f;

		hbridge_shutdown();
    } else if (fabs(current_state.peltier_current.filtered_value) > CURRENT_DANGER) {
    	hbridge_shutdown();
    } else {
        // Current PI control
    	current_state.hbridge_voltage_target = current_pi_control(current_state.peltier_current_target, current_state.peltier_current.filtered_value, &current_coef, &current_data);

        // Convert to duty and update bridge
    	current_state.hbridge_duty_cycle = voltage_to_duty(current_state.hbridge_voltage_target, BRIDGE_VOLTAGE);
        hbridge_update(current_state.hbridge_duty_cycle);
    }
}

void control_1ms_step() {
	if (!control_ready) {
		return;
	}

	auto new_status_revision = status_revision + 1;
	status_revision = 0;

    uint16_t adc_peltier_current, adc_lid_temp, adc_peltier_temp, adc_lid_current;
    ADC_GetValues(&adc_peltier_current, &adc_lid_temp, &adc_peltier_temp, &adc_lid_current);

    current_state.peltier_current.update(plt_adc12_to_current(adc_peltier_current));
    current_state.peltier_temperature.update(ntc_adc12_to_temperature(adc_peltier_temp));
    current_state.lid_current.update(lid_adc12_to_current(adc_lid_current));
    current_state.lid_temperature.update(ntc_adc12_to_temperature(adc_lid_temp));

    // Update peak detector for oscillation measurement
    current_state.peltier_peak_detector.update(current_state.peltier_temperature.filtered_value, control_tick_ms);
    control_tick_ms++;

    control_lid_1ms_step();

    control_peltier_1ms_step();

    status_revision = new_status_revision;


}

void control_get_status(control_status_t* status) {
	auto revision = status_revision.load();

	do {
		revision = status_revision;
		status->peltier_current_filtered = current_state.peltier_current.filtered_value;
		status->peltier_temperature_filtered = current_state.peltier_temperature.filtered_value;
		status->peltier_temperature_target = current_state.peltier_temperature_target;
		status->peltier_current_target = current_state.peltier_current_target;

		status->lid_current_filtered = current_state.lid_current.filtered_value;
		status->lid_temperature_filtered = current_state.lid_temperature.filtered_value;
		status->lid_temperature_target = current_state.lid_temperature_target;

		status->hbridge_voltage_target = current_state.hbridge_voltage_target;
		status->hbridge_duty_cycle = current_state.hbridge_duty_cycle;

		status->peltier_oscillation_period_ms = current_state.peltier_peak_detector.period_ms;

		// PID debug values
		status->pid_p = temp_data.last_p;
		status->pid_i = temp_data.last_i;
		status->pid_d = temp_data.last_d;
	} while (revision == 0 || revision != status_revision);
}

void control_set_target_lid(float temperature) {
	current_state.lid_temperature_target = temperature;
}

void control_set_target_peltier(float temperature) {
	current_state.peltier_temperature_target = temperature;
}
