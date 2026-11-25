#include "host_queue.h"
#include "config.h"
#include "stm_io.h"
#include "ws_bridge.h"
#include "scpi_line.h"

#include <string.h>

static const char *TAG = "host_queue";

typedef struct {
    uint8_t tag;
    uint8_t len;
    char line[HOST_LINE_MAX];
} host_entry_t;

static host_entry_t s_queue[HOST_QUEUE_DEPTH];
static uint8_t s_head = 0;   // next entry to pop
static uint8_t s_count = 0;

// Producers are the httpd task (/ws) and the websocket client task (cloud);
// the consumer is the STM32 link task. The copies are tiny, so a critical
// section is enough.
static portMUX_TYPE s_lock = portMUX_INITIALIZER_UNLOCKED;

static bool host_queue_push(uint8_t tag, const char* line, size_t len)
{
    bool ok = false;
    taskENTER_CRITICAL(&s_lock);
    if (s_count < HOST_QUEUE_DEPTH) {
        host_entry_t* e = &s_queue[(s_head + s_count) % HOST_QUEUE_DEPTH];
        e->tag = tag;
        e->len = (uint8_t)len;
        memcpy(e->line, line, len);
        s_count++;
        ok = true;
    }
    taskEXIT_CRITICAL(&s_lock);
    return ok;
}

bool host_queue_pop(uint8_t* tag, char* line, size_t* len)
{
    bool ok = false;
    taskENTER_CRITICAL(&s_lock);
    if (s_count > 0) {
        host_entry_t* e = &s_queue[s_head];
        *tag = e->tag;
        *len = e->len;
        memcpy(line, e->line, e->len);
        s_head = (s_head + 1) % HOST_QUEUE_DEPTH;
        s_count--;
        ok = true;
    }
    taskEXIT_CRITICAL(&s_lock);
    return ok;
}

void host_reply(uint8_t tag, const char* line, size_t len)
{
    // One SCPI response line (a single HOST_RESPONSE frame: SLIP payload minus
    // opcode and tag) plus the terminator the line-splitting clients rely on.
    char buf[SLIP_PAYLOAD_MAX + 1];
    if (len > sizeof(buf) - 1) {
        len = sizeof(buf) - 1;
    }
    memcpy(buf, line, len);
    buf[len++] = '\n';

    if (tag == HOST_TAG_LOCAL) {
        ws_send_to_client((const uint8_t *)buf, len);
    } else if (tag == HOST_TAG_CLOUD) {
        if (s_cloud_ws && esp_websocket_client_is_connected(s_cloud_ws)) {
            // Bounded wait: this runs on the STM32 link task, which must not
            // stall behind a slow cloud socket.
            esp_websocket_client_send_text(s_cloud_ws, buf, len, pdMS_TO_TICKS(100));
        }
    } else {
        ESP_LOGW(TAG, "reply for unknown tag %u dropped", (unsigned)tag);
    }
}

static void host_reply_err(uint8_t tag, int code)
{
    char err[64];
    int n = scpi_format_err(err, sizeof(err), code, NULL);
    host_reply(tag, err, (size_t)n);
}

static void host_queue_line(uint8_t tag, const char* line, size_t len)
{
    if (len == 0) {
        return;
    }

    // The cloud DeviceProxy relays user text verbatim but may also carry JSON
    // control messages (e.g. {"type":"ping"}); SCPI requests never start with
    // '{', so those are logged and not queued.
    if (tag == HOST_TAG_CLOUD && line[0] == '{') {
        size_t shown = len < HOST_LINE_MAX ? len : HOST_LINE_MAX;
        ESP_LOGI(TAG, "cloud control message: %.*s", (int)shown, line);
        return;
    }

    if (len > HOST_LINE_MAX) {
        host_reply_err(tag, SCPI_ERR_LINE_TOO_LONG);
        return;
    }

    if (!host_queue_push(tag, line, len)) {
        host_reply_err(tag, SCPI_ERR_BUSY);
    }
}

void host_queue_feed(uint8_t tag, const uint8_t* data, size_t len)
{
    // Split on '\n', dropping '\r'. A line is assembled into a bounded scratch
    // buffer; anything past HOST_LINE_MAX is only counted so the over-long
    // line is still reported (and discarded) as one unit.
    char line[HOST_LINE_MAX];
    size_t n = 0;

    for (size_t i = 0; i < len; i++) {
        char c = (char)data[i];
        if (c == '\r') {
            continue;
        }
        if (c == '\n') {
            host_queue_line(tag, line, n);
            n = 0;
            continue;
        }
        if (n < sizeof(line)) {
            line[n] = c;
        }
        n++;
    }
    // Trailing segment without a terminator: WebSocket messages are framed,
    // so treat it as a complete line.
    host_queue_line(tag, line, n);
}
