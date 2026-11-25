#pragma once

#include <stdint.h>

struct stage_configuration_t {
	const char* name;
	float max_peltier;
	float peltier;
	float min_peltier;
	uint16_t max_time;
	uint16_t time;
	uint16_t min_time;
	uint16_t delta_time;
};

enum {
	stage_intro_denaturing,
	stage_denaturing,
	stage_annealing,
	stage_extension,
	stage_final_extension,

	stages_num
};

struct pcr_operation_definition_t {
	stage_configuration_t stages[stages_num];
	uint16_t max_cycles;
	uint16_t cycles;
	uint16_t min_cycles;
};


/* Metadata of the current/last run started over the serial API (PROT:STAR). */
struct pcr_run_meta_t {
	char name[33];
	char comment[65];
	uint32_t start_tick;   /* HAL_GetTick() when the run was started */
};

extern const char* stage_name[stages_num];
extern pcr_operation_definition_t operation_definition;
extern pcr_run_meta_t run_meta;
