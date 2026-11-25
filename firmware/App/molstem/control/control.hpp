#include <stdint.h>

void control_init();
void control_1ms_step();

struct peak_detector_t {
	float filtered_temp;
	float min_temp;
	float max_temp;
	uint32_t last_peak_time_ms;
	uint32_t period_ms;
	bool initialized;
	bool looking_for_peak;  // true = looking for max, false = looking for min

	static constexpr float MIN_AMPLITUDE = 0.1f;  // Minimum peak-to-trough amplitude
	static constexpr uint32_t MIN_PERIOD_MS = 250;  // Minimum time between peaks (quarter second)
	static constexpr float FILTER_ALPHA = 0.05f;  // Low-pass filter coefficient

	void reset() {
		filtered_temp = 0;
		min_temp = 1000.0f;
		max_temp = -1000.0f;
		last_peak_time_ms = 0;
		period_ms = 0;
		initialized = false;
		looking_for_peak = true;
	}

	void update(float temp, uint32_t now_ms) {
		// Low-pass filter the temperature
		if (!initialized) {
			filtered_temp = temp;
			min_temp = temp;
			max_temp = temp;
			initialized = true;
			return;
		}

		filtered_temp = (1.0f - FILTER_ALPHA) * filtered_temp + FILTER_ALPHA * temp;

		if (looking_for_peak) {
			// Track maximum
			if (filtered_temp > max_temp) {
				max_temp = filtered_temp;
			}
			// Detect peak: dropped significantly from max
			if (filtered_temp < max_temp - MIN_AMPLITUDE) {
				// Peak confirmed at max_temp
				uint32_t time_since_last = now_ms - last_peak_time_ms;
				if (last_peak_time_ms > 0 && time_since_last >= MIN_PERIOD_MS) {
					period_ms = time_since_last;
				}
				last_peak_time_ms = now_ms;
				min_temp = filtered_temp;
				looking_for_peak = false;
			}
		} else {
			// Track minimum
			if (filtered_temp < min_temp) {
				min_temp = filtered_temp;
			}
			// Detect trough: risen significantly from min
			if (filtered_temp > min_temp + MIN_AMPLITUDE) {
				// Trough confirmed, now look for next peak
				max_temp = filtered_temp;
				looking_for_peak = true;
			}
		}
	}
};

struct control_status_t {
	float peltier_current_filtered;
	float peltier_temperature_filtered;
	float peltier_temperature_target;
	float peltier_current_target;

	float lid_current_filtered;
	float lid_temperature_filtered;
	float lid_temperature_target;

	float hbridge_voltage_target;
	float hbridge_duty_cycle;

	uint32_t peltier_oscillation_period_ms;

	// PID debug: individual contributions (in current units, before clamping)
	float pid_p;  // Proportional contribution: Kp * error
	float pid_i;  // Integral contribution: Kp * Te_i
	float pid_d;  // Derivative contribution: Kp * Te_d
};

void control_get_status(control_status_t* status);

#define TARGET_DISABLED (-1.f)
void control_set_target_lid(float temperature);
void control_set_target_peltier(float temperature);
