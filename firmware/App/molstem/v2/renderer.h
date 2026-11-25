#pragma once
#include "helpers/microtask_scheduler.hpp"

microtask::Task renderer_task();

void display_init();
void renderer_cursor(unsigned char row, unsigned char col);
void renderer_string(const char* string);
void renderer_left(unsigned char row, unsigned char col, const char* string);
void renderer_centered(unsigned char row, unsigned char col, const char* string);
void renderer_centered(unsigned char row, const char* string);
void renderer_right(unsigned char row, unsigned char col, const char* string);
void renderer_right(unsigned char row, const char* string);
void renderer_clear();
void renderer_display();
bool was_rotary_pressed();

void editable_define_focus_group(uint32_t count);
void editable_value(const char* prefix, float* value, const char* postfix, float min, float max, float step, bool ms = false, const char* fmt = "%.0f");
void editable_value(const char* prefix, uint16_t* value, const char* postfix, uint16_t min, uint16_t max, uint16_t step, bool ms = false);
bool selectable_label(const char* label);
bool enum_label_values(const char* label, const char** values, unsigned num_values, unsigned* value);
bool invisible_focus_guard();
