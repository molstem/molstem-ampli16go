#include "renderer.h"
#include "helpers/helpers.hpp"

#include "tui.h"

extern "C" {
	#include "drivers/lcd.h"
	#include "drivers/buzzer.h"
}



Lcd_HandleTypeDef lcd;

extern volatile int32_t encoder_counter;
extern volatile uint8_t encoder_button_state;
extern volatile uint32_t encoder_button_last_press_time;

using namespace microtask;
using namespace std::chrono_literals;

Lcd_PortType lcd_ports[] = {LCD_D4_GPIO_Port, LCD_D5_GPIO_Port, LCD_D6_GPIO_Port, LCD_D7_GPIO_Port};
Lcd_PinType lcd_pins[] = {LCD_D4_Pin, LCD_D5_Pin, LCD_D6_Pin, LCD_D7_Pin};


void display_init() {
	lcd = Lcd_create(lcd_ports, lcd_pins, LCD_RS_GPIO_Port, LCD_RS_Pin, LCD_EN_GPIO_Port, LCD_EN_Pin, LCD_4_BIT_MODE);
}


Task renderer_task() {
	co_await yield_reschedule();
	display_init();
	for (;;) {
		tui_render();
		co_await yield_for(100ms);
	}
}

unsigned char cursor_x;
unsigned char cursor_y;

char back_buffer[LCD_ROWS][LCD_COLS + 1];
char front_buffer[LCD_ROWS][LCD_COLS];

void renderer_cursor(unsigned char row, unsigned char col) {
	cursor_x = col;
	cursor_y = row;
}
void renderer_string(const char* string) {
	auto len = strlen(string);
	if (len + cursor_x > LCD_COLS) {
		len = LCD_COLS - cursor_x;
	}
	if (len == 0) {
		return;
	}

	while(len--) {
		back_buffer[cursor_y][cursor_x++] = *string++;
	}
}
void renderer_left(unsigned char row, unsigned char col, const char* string) {
	renderer_cursor(row, col);
	renderer_string(string);
}

void renderer_centered(unsigned char row, unsigned char leftpad, const char* string) {
	renderer_cursor(row, leftpad + ((LCD_COLS - leftpad) - strlen(string))/2);
	renderer_string(string);
}
void renderer_centered(unsigned char row, const char* string) {
	renderer_centered(row, 0, string);
}

void renderer_right(unsigned char row, unsigned char rightpad, const char* string) {
	renderer_cursor(row, LCD_COLS - rightpad - strlen(string));
	renderer_string(string);
}
void renderer_right(unsigned char row, const char* string) {
	renderer_right(row, 0, string);
}

void renderer_clear() {
	memset(back_buffer, ' ', sizeof(back_buffer));
}
void renderer_display() {
	bool existing_span = false;
	for (unsigned row=0; row < LCD_ROWS; row++) {
		for (unsigned col=0; col < LCD_COLS; col++) {
			char bb = back_buffer[row][col];
			if (front_buffer[row][col] != bb) {
				front_buffer[row][col] = bb;
				if (!existing_span || col == 0) {
					existing_span = true;
					Lcd_cursor(&lcd, row, col);
				}
				Lcd_char(&lcd, bb);
			} else if (existing_span) {
				existing_span = false;
			}
		}
	}
}

bool was_rotary_pressed() {
	if ((HAL_GetTick() - encoder_button_last_press_time) > 20 && encoder_button_state) {
		encoder_button_state = 0;
		return true;
	}
	return false;
}

uint32_t current_focus_count;
uint32_t current_focus;
uint32_t last_focus;
int32_t current_focus_editing = -1;

void editable_define_focus_group(uint32_t count) {
	current_focus_count = 0;
	last_focus = current_focus;
	current_focus = current_focus_editing == -1 ? encoder_counter % int32_t(count) : current_focus_editing;

	if (current_focus >= count) {
		current_focus = count + current_focus;
	}
}

void editable_value(const char* prefix, float* value, const char* postfix, float min, float max, float step, bool ms, const char *fmt) {
	if (current_focus_count++ == current_focus) {
		if (current_focus_editing != -1) {
			renderer_string(":");
			if (was_rotary_pressed()) {
				encoder_counter = current_focus_editing;
				current_focus_editing = -1;
			} else {
				*value = min + wrap_values(encoder_counter, uint32_t(max-min+step)/step)*step;
			}
		} else {
			renderer_string(">");
			if (was_rotary_pressed()) {
				current_focus_editing = current_focus;
				encoder_counter = uint32_t((*value - min) / step);
			}
		}
	} else {
		renderer_string(" ");
	}
	renderer_string(prefix);
	char temp[11];
	if (ms) {
		int32_t m = ((int32_t)*value) / 60;
		float s = *value - m * 60;
		if (m) {
			snprintf(temp, sizeof(temp), "%dm %.0f", (int)m, s);
		} else {
			snprintf(temp, sizeof(temp), "%.0f", s);
		}
	} else {
		snprintf(temp, sizeof(temp), fmt, *value);
	}
	temp[10] = 0;
	renderer_string(temp);
	renderer_string(postfix);
}

void editable_value(const char* prefix, uint16_t* value, const char* postfix, uint16_t min, uint16_t max, uint16_t step, bool ms) {
	if (current_focus_count++ == current_focus) {
		if (current_focus_editing != -1) {
			renderer_string(":");
			if (was_rotary_pressed()) {
				encoder_counter = current_focus_editing;
				current_focus_editing = -1;
			} else {
				*value = min + wrap_values(encoder_counter, uint32_t(max-min+step)/step)*step;
			}
		} else {
			renderer_string(">");
			if (was_rotary_pressed()) {
				current_focus_editing = current_focus;
				encoder_counter = uint32_t((*value - min) / step);
			}
		}
	} else {
		renderer_string(" ");
	}
	renderer_string(prefix);
	char temp[11];
	if (ms) {
		int32_t m = ((int32_t)*value) / 60;
		int32_t s = ((int32_t)*value) % 60;
		if (m) {
			snprintf(temp, sizeof(temp), "%dm %d", (int)m, (int)s);
		} else {
			snprintf(temp, sizeof(temp), "%d", (int)s);
		}
	} else {
		snprintf(temp, sizeof(temp), "%d", *value);
	}
	temp[10] = 0;
	renderer_string(temp);
	renderer_string(postfix);
}

bool selectable_label(const char* label) {
	bool was_selected = false;
	if (current_focus_count++ == current_focus) {
		renderer_string(">");
		was_selected = was_rotary_pressed();
	} else {
		renderer_string(" ");
	}

	renderer_string(label);

	return was_selected;
}

bool enum_label_values(const char* label, const char** values, unsigned num_values, unsigned* value) {
	bool rv = false;
	if (current_focus_count++ == current_focus) {
		if (current_focus_editing != -1) {
			renderer_string(" ");
			renderer_string(label);
			renderer_string(" :");
			renderer_string(values[*value]);
			if (was_rotary_pressed()) {
				encoder_counter = current_focus_editing;
				current_focus_editing = -1;
				rv = true;
			} else {
				*value = wrap_values(encoder_counter, num_values);
			}
		} else {
			renderer_string(">");
			renderer_string(label);
			renderer_string("  ");
			renderer_string(values[*value]);
			if (was_rotary_pressed()) {
				current_focus_editing = current_focus;
				encoder_counter = *value;
			}
		}
	} else {
		renderer_string(" ");
		renderer_string(label);
		renderer_string("  ");
		renderer_string(values[*value]);
	}

	return rv;
}

bool invisible_focus_guard() {
	bool rv = current_focus_count++ == current_focus;
	if (rv) {
		encoder_counter = last_focus;
	}
	return rv;
}
