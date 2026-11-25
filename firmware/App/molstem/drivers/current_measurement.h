/*
 * current_measurement.h
 *
 *  Created on: Mar 6, 2025
 *      Author: sebas
 */

#ifndef INC_CURRENT_MEASUREMENT_H_
#define INC_CURRENT_MEASUREMENT_H_

#include <stdint.h>
#include <stdbool.h>

float lid_adc12_to_current(uint16_t adc_value);
float plt_adc12_to_current(uint16_t adc_value);

#endif /* INC_CURRENT_MEASUREMENT_H_ */
