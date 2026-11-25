#pragma once

#include <cstdint>

#include "helpers/microtask_scheduler.hpp"
microtask::Task ui_task();
microtask::Task renderer_task();
void tui_render();

void network_status_periodical();
void tui_render_provision();

/* Starts a run of `operation_definition` (must be called on the TUI/scheduler thread). */
void on_tui_in_operation();

/* Sentinels stored in in_operation_remaining_seconds while no countdown is running. */
#define PROGRESS_HEATING_LID (-1)
#define PROGRESS_COOLING (-2)
#define PROGRESS_HEATING (-3)

/* Consistent copy of the run related ui_state fields (see tui_get_run_snapshot). */
struct tui_run_snapshot_t {
	bool ready;                 /* mode_ready */
	bool running;               /* mode_in_operation */
	bool pid_tune;              /* page_pid_tune is shown */
	const char* phase_text;     /* in_opreation_text: stage_name[i], "Lid pre-heating" or "starting up" */
	uint16_t current_cycle;     /* 0-based */
	uint16_t total_cycles;
	unsigned remaining_seconds; /* seconds or a PROGRESS_* sentinel */
	bool canceled;
	bool cancel_ui;
	bool completed;
	int total_time_s;           /* protocol duration excluding ramps */
};

void tui_get_run_snapshot(tui_run_snapshot_t* snapshot);

/* True when a run may be started (mode_ready and not on the PID tune page). */
bool tui_can_start_run();

/* Request abort of the running protocol. Returns false when nothing is running
 * (or it is already aborting/completed). Safe to call from any thread. */
bool tui_request_abort();
