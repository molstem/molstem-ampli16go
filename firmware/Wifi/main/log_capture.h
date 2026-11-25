// Captures ESP_LOGx output into a RAM ring buffer so it can be read back over
// HTTP. The board does not break out the ESP32-C5 USB-Serial-JTAG pins and
// UART0 is taken by the STM32 link, so there is no reachable console once the
// module is soldered down - this is the only way to see what the C5 is doing.
#pragma once

#include <stddef.h>

// Install the vprintf hook. Call as early as possible in app_main() so startup
// logging is captured too. Safe to call more than once.
void log_capture_init(void);

// Copy the buffered log, oldest line first, into buf as a NUL-terminated
// string. Returns the number of bytes written, excluding the terminator.
size_t log_capture_dump(char *buf, size_t buf_size);

// Total bytes currently held in the ring buffer.
size_t log_capture_size(void);
