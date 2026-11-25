/*
 * current_measurement.c
 *
 *  Created on: Mar 6, 2025
 *      Author: sebas
 *
 *  Updated by: Arash Noroozi
 */


#include <stdint.h>
#include <stdbool.h>

#include "current_measurement.h"

#define D_AVCC0         (3.3F)                          /** Analog voltage [V/V]                    */
#define D_RS            (0.014F)                        /** Current detection resistor [Ohm]        */
#define D_KCSA          (20.0F)                         /** Current detection amplifier gain [V/V]  */
#define D_KS          	(D_AVCC0 / (2.0 * D_RS * D_KCSA))     /** Current conversion factor     */
#define D_ADFS          (4096UL)                        /* 2^12 : 12-bit ADC resolution */

/*
 * Converting 12 bit ADC to current value
 * The following functions are both working
 */

float plt_adc12_to_current(uint16_t adc_value)
{
    // Original calculation
    float f_current = ((float)adc_value - 2048.0f) * D_KS / 2048.0f;

//    // Clamp to actual measurable range
//    if (f_current > 1.2f) return 1.2f;
//    if (f_current < -1.2f) return -1.2f;

    return f_current;
}

#define LD_AVCC0         (3.3F)                          /** Analog voltage [V/V]                    */
#define LD_RS            (0.056F)                        /** Current detection resistor [Ohm]        */
#define LD_KCSA          (20.0F)                         /** Current detection amplifier gain [V/V]  */
#define LD_KS          	(D_AVCC0 / (2.0 * LD_RS * LD_KCSA))     /** Current conversion factor     */
#define LD_ADFS          (4096UL)                        /* 2^12 : 12-bit ADC resolution */

/*
 * Converting 12 bit ADC to current value
 * The following functions are both working
 */

float lid_adc12_to_current(uint16_t adc_value)
{
    // Original calculation
    float f_current = ((float)adc_value - 2048.0f) * LD_KS / 2048.0f;

//    // Clamp to actual measurable range
//    if (f_current > 1.2f) return 1.2f;
//    if (f_current < -1.2f) return -1.2f;

    return f_current;
}

