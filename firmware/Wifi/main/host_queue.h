#pragma once

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

// Queue of SCPI request lines received from the local /ws client (tag 0) and
// the cloud device socket (tag 1). The STM32 drains it with HOST_POLL and
// returns each reply with HOST_RESPONSE, which host_reply() routes back to the
// tagged socket as a text frame. See docs/serial-api.md.

#define HOST_TAG_LOCAL 0
#define HOST_TAG_CLOUD 1

#define HOST_QUEUE_DEPTH 8

// Longest request line (no terminator) that can be handed to the STM32: the
// HOST_LINE reply payload is opcode + tag + line and must fit SLIP_PAYLOAD_MAX.
#define HOST_LINE_MAX 254

// Feed one WebSocket message. It is split on '\n' ('\r' ignored, empty lines
// dropped); a trailing segment without '\n' is a line too, since WebSocket
// messages are self-delimiting. Over-long lines get ERR 101 and, when the queue
// is full, ERR 202 - both answered directly on the originating socket.
void host_queue_feed(uint8_t tag, const uint8_t* data, size_t len);

// Take the oldest queued line. `line` needs room for HOST_LINE_MAX bytes (no
// terminator is written). Returns false when the queue is empty.
bool host_queue_pop(uint8_t* tag, char* line, size_t* len);

// Send `line` (no terminator; "\n" is appended) as a text frame to the socket
// identified by `tag`. Silently drops when that socket is not connected.
void host_reply(uint8_t tag, const char* line, size_t len);
