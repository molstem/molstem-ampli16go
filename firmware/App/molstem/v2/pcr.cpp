#include "pcr.h"

#define DELTA_TEMP 1.0
#define DELTA_CYCLE 1
#define DEFAULT_TEMP_LID 105
#define DEFAULT_CYCLE_INTRO_DENATURING 1
#define DEFAULT_CYCLE_FINAL_EXTENSION 1

#define MAX_TEMP_INTRO_DENATURING 99.0
#define DEFAULT_TEMP_INTRO_DENATURING 95.0
#define MIN_TEMP_INTRO_DENATURING 20.0
#define MAX_TIME_INTRO_DENATURING 600
#define DEFAULT_TIME_INTRO_DENATURING 10
#define MIN_TIME_INTRO_DENATURING 10
#define DELTA_TIME_INTRO_DENATURING 10

#define MAX_TEMP_DENATURING 99.0
#define DEFAULT_TEMP_DENATURING 95.0
#define MIN_TEMP_DENATURING 20.0
#define MAX_TIME_DENATURING 300
#define DEFAULT_TIME_DENATURING 10
#define MIN_TIME_DENATURING 1
#define DELTA_TIME_DENATURING 1

#define MAX_TEMP_ANNEALING 99.0
#define DEFAULT_TEMP_ANNEALING 60.0
#define MIN_TEMP_ANNEALING 20.0
#define MAX_TIME_ANNEALING 300
#define DEFAULT_TIME_ANNEALING 10
#define MIN_TIME_ANNEALING 5
#define DELTA_TIME_ANNEALING 1

#define MAX_TEMP_EXTENSION 99.0
#define DEFAULT_TEMP_EXTENSION 72.0
#define MIN_TEMP_EXTENSION 20.0
#define MAX_TIME_EXTENSION 300
#define DEFAULT_TIME_EXTENSION 10
#define MIN_TIME_EXTENSION 1
#define DELTA_TIME_EXTENSION 1

#define MAX_TEMP_FINAL_EXTENSION 99.0
#define DEFAULT_TEMP_FINAL_EXTENSION 72.0
#define MIN_TEMP_FINAL_EXTENSION 20.0
#define MAX_TIME_FINAL_EXTENSION 300
#define DEFAULT_TIME_FINAL_EXTENSION 10
#define MIN_TIME_FINAL_EXTENSION 10
#define DELTA_TIME_FINAL_EXTENSION 10

#define MIN_CYCLE 1
#define DEFAULT_CYCLE 5
#define MAX_CYCLE 50



const char* stage_name[stages_num] = { "Intro denaturing", "Denaturing", "Annealing", "Extension", "Final extension" };
pcr_operation_definition_t operation_definition = {
	.stages = {
		// Intro denaturing
		{
			.name = stage_name[0],
			.max_peltier = MAX_TEMP_INTRO_DENATURING,
			.peltier = DEFAULT_TEMP_INTRO_DENATURING,
			.min_peltier = MIN_TEMP_INTRO_DENATURING,
			.max_time = MAX_TIME_INTRO_DENATURING,
			.time = DEFAULT_TIME_INTRO_DENATURING,
			.min_time = MIN_TIME_INTRO_DENATURING,
			.delta_time = DELTA_TIME_INTRO_DENATURING,
		},
		// Denaturing
		{
			.name = stage_name[0],
			.max_peltier = MAX_TEMP_DENATURING,
			.peltier = DEFAULT_TEMP_DENATURING,
			.min_peltier = MIN_TEMP_DENATURING,
			.max_time = MAX_TIME_DENATURING,
			.time = DEFAULT_TIME_DENATURING,
			.min_time = MIN_TIME_DENATURING,
			.delta_time = DELTA_TIME_DENATURING,
		},
		// Annealing
		{
			.name = stage_name[0],
			.max_peltier = MAX_TEMP_ANNEALING,
			.peltier = DEFAULT_TEMP_ANNEALING,
			.min_peltier = MIN_TEMP_ANNEALING,
			.max_time = MAX_TIME_ANNEALING,
			.time = DEFAULT_TIME_ANNEALING,
			.min_time = MIN_TIME_ANNEALING,
			.delta_time = DELTA_TIME_ANNEALING,
		},
		// Extension
		{
			.name = stage_name[0],
			.max_peltier = MAX_TEMP_EXTENSION,
			.peltier = DEFAULT_TEMP_EXTENSION,
			.min_peltier = MIN_TEMP_EXTENSION,
			.max_time = MAX_TIME_EXTENSION,
			.time = DEFAULT_TIME_EXTENSION,
			.min_time = MIN_TIME_EXTENSION,
			.delta_time = DELTA_TIME_EXTENSION,
		},
		// Final extension
		{
			.name = stage_name[0],
			.max_peltier = MAX_TEMP_FINAL_EXTENSION,
			.peltier = DEFAULT_TEMP_FINAL_EXTENSION,
			.min_peltier = MIN_TEMP_FINAL_EXTENSION,
			.max_time = MAX_TIME_FINAL_EXTENSION,
			.time = DEFAULT_TIME_FINAL_EXTENSION,
			.min_time = MIN_TIME_FINAL_EXTENSION,
			.delta_time = DELTA_TIME_FINAL_EXTENSION,
		}
	},
	.max_cycles = MAX_CYCLE,
	.cycles = DEFAULT_CYCLE,
	.min_cycles = MIN_CYCLE,
};

pcr_run_meta_t run_meta = {
	.name = "",
	.comment = "",
	.start_tick = 0,
};


