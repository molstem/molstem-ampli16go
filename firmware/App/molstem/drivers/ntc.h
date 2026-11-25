/*
 * ntc.h
 *
 *  Created on: Feb 7, 2025
 *      Author: sebas
 */

#ifndef INC_NTC_H_
#define INC_NTC_H_

#include <stdint.h>

// Parameters of NTC 10k thermistor connection
#define ADC_RESOLUTION 16777215.0f  // 24-bit ADC (2^24 - 1)
#define V_REF 3.3f                // Napięcie odniesienia ADC [V]
#define R_REF 10000.0f            // Rezystor dzielnika napięcia [Ω]
#define B_COEFFICIENT 3950.0f       // Współczynnik B termistora
#define T0 298.15f                  // Temperatura odniesienia (25°C w kelwinach)
#define R25 10000.0f                // Rezystancja termistora przy 25°C [Ω]

float ntc_adc12_to_temperature(uint16_t adc_value);

#endif /* INC_NTC_H_ */
