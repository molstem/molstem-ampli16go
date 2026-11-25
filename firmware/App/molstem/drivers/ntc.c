/*
 * ntc.c
 *
 *  Created on: Feb 7, 2025
 *      Author: sebas
 */


#include "ntc.h"
#include <math.h>
#include <stdint.h>
#include <stddef.h>
#include <float.h>

/**
 * @brief Convert internal ADC raw value to temperature
 * @param adc_raw Raw ADC value (0-4095)
 * @return Temperature in Celsius
 */
float ntc_adc12_to_temperature_beta(uint16_t adc_value) {
    // Convert 12-bit ADC (0-4095) to voltage
    float voltage = ((float)adc_value / 4095.0f) * 3.3f;

    if (voltage >= 3.29f) {
        return -50.0f;  // Protection against division by zero
    }

    // Calculate NTC resistance from voltage divider
    float ntc_resistance = 10000.0f * voltage / (3.3f - voltage);

    // Steinhart-Hart equation
    float temperature_kelvin = 1.0f / ((1.0f / T0) + (1.0f / B_COEFFICIENT) * log(ntc_resistance / R25));
    float temperature_celsius = temperature_kelvin - 273.15f;

    return temperature_celsius;
}

#define T_MIN_C   (-40)
#define T_MAX_C     125
#define N_SAMPLES  ((T_MAX_C - T_MIN_C) + 1)

float ntc_R_ohm[N_SAMPLES] = {
/*-40*/ 336103.0,
/*-39*/ 314558.0,
/*-38*/ 294529.0,
/*-37*/ 275901.0,
/*-36*/ 258567.0,
/*-35*/ 242430.0,
/*-34*/ 227401.0,
/*-33*/ 213397.0,
/*-32*/ 200341.0,
/*-31*/ 188166.0,
/*-30*/ 176805.0,
/*-29*/ 166200.0,
/*-28*/ 156296.0,
/*-27*/ 147043.0,
/*-26*/ 138395.0,
/*-25*/ 130308.0,
/*-24*/ 122742.0,
/*-23*/ 115662.0,
/*-22*/ 109033.0,
/*-21*/ 102825.0,
/*-20*/ 97006.9,
/*-19*/ 91553.3,
/*-18*/ 86439.2,
/*-17*/ 81641.4,
/*-16*/ 77138.6,
/*-15*/ 72911.1,
/*-14*/ 68940.4,
/*-13*/ 65209.7,
/*-12*/ 61702.9,
/*-11*/ 58405.5,
/*-10*/ 55303.9,
/*-9*/ 52385.2,
/*-8*/ 49637.8,
/*-7*/ 47050.6,
/*-6*/ 44613.4,
/*-5*/ 42316.7,
/*-4*/ 40151.6,
/*-3*/ 38110.0,
/*-2*/ 36184.0,
/*-1*/ 34366.6,
/*0*/ 32650.9,
/*1*/ 31030.8,
/*2*/ 29500.5,
/*3*/ 28054.4,
/*4*/ 26687.5,
/*5*/ 25395.0,
/*6*/ 24172.5,
/*7*/ 23015.9,
/*8*/ 21921.2,
/*9*/ 20884.7,
/*10*/ 19903.2,
/*11*/ 18973.3,
/*12*/ 18092.2,
/*13*/ 17256.9,
/*14*/ 16464.9,
/*15*/ 15713.7,
/*16*/ 15000.9,
/*17*/ 14324.5,
/*18*/ 13682.3,
/*19*/ 13072.6,
/*20*/ 12493.3,
/*21*/ 11943.0,
/*22*/ 11419.9,
/*23*/ 10922.7,
/*24*/ 10449.8,
/*25*/ 10000.0,
/*26*/ 9572.0,
/*27*/ 9164.7,
/*28*/ 8777.0,
/*29*/ 8407.7,
/*30*/ 8056.1,
/*31*/ 7721.0,
/*32*/ 7401.7,
/*33*/ 7097.3,
/*34*/ 6807.1,
/*35*/ 6530.3,
/*36*/ 6266.2,
/*37*/ 6014.3,
/*38*/ 5773.8,
/*39*/ 5544.2,
/*40*/ 5325.0,
/*41*/ 5115.6,
/*42*/ 4915.6,
/*43*/ 4724.4,
/*44*/ 4541.7,
/*45*/ 4367.0,
/*46*/ 4200.0,
/*47*/ 4040.2,
/*48*/ 3887.4,
/*49*/ 3741.1,
/*50*/ 3601.1,
/*51*/ 3467.0,
/*52*/ 3338.7,
/*53*/ 3215.8,
/*54*/ 3098.0,
/*55*/ 2985.2,
/*56*/ 2877.0,
/*57*/ 2773.3,
/*58*/ 2673.9,
/*59*/ 2578.6,
/*60*/ 2487.1,
/*61*/ 2399.4,
/*62*/ 2315.2,
/*63*/ 2234.4,
/*64*/ 2156.8,
/*65*/ 2082.3,
/*66*/ 2010.8,
/*67*/ 1942.1,
/*68*/ 1876.0,
/*69*/ 1812.6,
/*70*/ 1751.6,
/*71*/ 1693.0,
/*72*/ 1636.6,
/*73*/ 1582.4,
/*74*/ 1530.2,
/*75*/ 1480.1,
/*76*/ 1431.8,
/*77*/ 1385.3,
/*78*/ 1340.6,
/*79*/ 1297.5,
/*80*/ 1256.1,
/*81*/ 1216.1,
/*82*/ 1177.7,
/*83*/ 1140.6,
/*84*/ 1104.9,
/*85*/ 1070.5,
/*86*/ 1037.3,
/*87*/ 1005.3,
/*88*/ 974.4,
/*89*/ 944.7,
/*90*/ 916.0,
/*91*/ 888.3,
/*92*/ 861.5,
/*93*/ 835.8,
/*94*/ 810.9,
/*95*/ 786.8,
/*96*/ 763.6,
/*97*/ 741.2,
/*98*/ 719.6,
/*99*/ 698.6,
/*100*/ 678.4,
/*101*/ 658.9,
/*102*/ 640.0,
/*103*/ 621.8,
/*104*/ 604.2,
/*105*/ 587.1,
/*106*/ 570.6,
/*107*/ 554.6,
/*108*/ 539.2,
/*109*/ 524.3,
/*110*/ 509.8,
/*111*/ 495.9,
/*112*/ 482.3,
/*113*/ 469.2,
/*114*/ 456.5,
/*115*/ 444.2,
/*116*/ 432.3,
/*117*/ 420.8,
/*118*/ 409.7,
/*119*/ 398.8,
/*120*/ 388.4,
/*121*/ 378.2,
/*122*/ 368.3,
/*123*/ 358.8,
/*124*/ 349.5,
/*125*/ 340.6,
};

static inline float ntc_linear_linear(float R_ohm)
{
    if (R_ohm <= 0.0f || !isfinite(R_ohm)) {
        return NAN;
    }

    if (R_ohm >= ntc_R_ohm[0]) return (float)T_MIN_C;
    if (R_ohm <= ntc_R_ohm[N_SAMPLES-1]) return (float)T_MAX_C;

    for (int i = 0; i < (N_SAMPLES-1); i++) {
        float R_high = ntc_R_ohm[i];
        float R_low  = ntc_R_ohm[i + 1];

        if (R_ohm <= R_high && R_ohm >= R_low) {
            float t_frac = (R_high - R_ohm) / (R_high - R_low);
            return (float)(T_MIN_C + i) + t_frac;
        }
    }
    return NAN;
}

#define ADC_MAX 4095
#define R_PULL 10000.0f

/**
 * @brief Convert internal ADC raw value to temperature
 * @param adc_raw Raw ADC value (0-4095)
 * @return Temperature in Celsius
 */
float ntc_adc12_to_temperature(uint16_t adc_value) {
     if (adc_value == 0) {
        // Node ~0V → R_ntc ~ 0Ω (very hot)
        return (float)T_MAX_C;
    }
    if (adc_value >= ADC_MAX) {
        // Node ~Vref → R_ntc → ∞ (very cold)
        return (float)T_MIN_C;
    }
    float code = (float)adc_value;
    float R_ntc = R_PULL * (code / (float)(ADC_MAX - adc_value));
    return ntc_linear_linear(R_ntc);
}
