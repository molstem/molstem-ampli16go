#include "log_capture.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "freertos/FreeRTOS.h"

#define LOG_RING_SIZE 8192   // bytes of history kept
#define LOG_LINE_MAX  256    // longest single formatted log line kept intact

static char s_ring[LOG_RING_SIZE];
static size_t s_head;        // next write position
static bool s_wrapped;       // true once the ring has cycled at least once
static bool s_installed;

static vprintf_like_t s_prev_vprintf;

// Guards only the memcpy into the ring, so it stays a short critical section.
// A spinlock rather than a mutex: the hook can be reached from any task and
// must never block whoever is logging.
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;

static void ring_write(const char *data, size_t len)
{
    if (len == 0) {
        return;
    }
    if (len > LOG_RING_SIZE) {
        // Keep the tail of an oversized line; the start is the least useful part.
        data += len - LOG_RING_SIZE;
        len = LOG_RING_SIZE;
    }

    portENTER_CRITICAL(&s_lock);

    size_t first = LOG_RING_SIZE - s_head;
    if (first > len) {
        first = len;
    }
    memcpy(&s_ring[s_head], data, first);

    size_t rest = len - first;
    if (rest > 0) {
        memcpy(&s_ring[0], data + first, rest);
        s_wrapped = true;
    }

    s_head += len;
    if (s_head >= LOG_RING_SIZE) {
        s_head -= LOG_RING_SIZE;
        s_wrapped = true;
    }

    portEXIT_CRITICAL(&s_lock);
}

// Must not call ESP_LOGx itself - that would recurse straight back in here.
static int log_capture_vprintf(const char *fmt, va_list args)
{
    char line[LOG_LINE_MAX];

    va_list args_copy;
    va_copy(args_copy, args);
    int n = vsnprintf(line, sizeof(line), fmt, args_copy);
    va_end(args_copy);

    if (n > 0) {
        size_t len = (n < (int)sizeof(line)) ? (size_t)n : sizeof(line) - 1;
        ring_write(line, len);
    }

    // Still hand off to the original sink, so a console remains usable if one
    // is ever attached.
    if (s_prev_vprintf) {
        return s_prev_vprintf(fmt, args);
    }
    return n;
}

void log_capture_init(void)
{
    if (s_installed) {
        return;
    }
    s_installed = true;
    s_prev_vprintf = esp_log_set_vprintf(log_capture_vprintf);
}

size_t log_capture_size(void)
{
    return s_wrapped ? LOG_RING_SIZE : s_head;
}

size_t log_capture_dump(char *buf, size_t buf_size)
{
    if (buf == NULL || buf_size == 0) {
        return 0;
    }

    portENTER_CRITICAL(&s_lock);
    size_t head = s_head;
    bool wrapped = s_wrapped;
    portEXIT_CRITICAL(&s_lock);

    size_t available = wrapped ? LOG_RING_SIZE : head;
    size_t want = available;
    if (want > buf_size - 1) {
        want = buf_size - 1;   // keep the newest bytes if the caller is short
    }

    // Oldest byte sits at head when wrapped, at 0 otherwise; skip forward if we
    // are only returning the tail.
    size_t start = (wrapped ? head : 0) + (available - want);
    start %= LOG_RING_SIZE;

    size_t first = LOG_RING_SIZE - start;
    if (first > want) {
        first = want;
    }
    memcpy(buf, &s_ring[start], first);
    if (want > first) {
        memcpy(buf + first, &s_ring[0], want - first);
    }

    buf[want] = '\0';
    return want;
}
