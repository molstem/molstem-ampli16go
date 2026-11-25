/*
 * buzzer.h
 *
 *  Created on: Jan 19, 2025
 *      Author: sebas
 */

#ifndef INC_BUZZER_H_
#define INC_BUZZER_H_

#include <stdint.h>

void buzzer_beep(uint32_t ms);
void buzzer_beep_state(int beep);

#endif /* INC_BUZZER_H_ */
