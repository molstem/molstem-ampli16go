/*
 * scpi_line — minimal SCPI-style line protocol parser/dispatcher.
 *
 * Shared by the STM32 application, the STM32 bootloader and the ESP32 Wi-Fi
 * firmware. Canonical copy: firmware/common/scpi/. The per-project copies are
 * refreshed with firmware/tools/sync_scpi.py — edit the canonical file only.
 *
 * Wire format
 *   request : <HEADER>[ <arg>[,<arg>...]]\n        '\r' is ignored, header is case-insensitive
 *   args    : comma separated; "quoted" args may contain commas/spaces, "" is a literal quote
 *   reply   : one line per request — query data, "OK", "OK <n>", or ERR <code>,"<message>"
 *   empty request lines produce no reply.
 *
 * No heap, no RTOS, no HAL: only <stdint.h>, <string.h>, <ctype.h>, <stdlib.h>.
 * Plain C99 so it compiles as C (ESP-IDF) and C++ (STM32CubeIDE projects).
 */
#ifndef SCPI_LINE_H
#define SCPI_LINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Per-build limits. Override before including or with -D. */
#ifndef SCPI_LINE_MAX
#define SCPI_LINE_MAX 256      /* longest request line incl. terminator */
#endif
#ifndef SCPI_OUT_MAX
#define SCPI_OUT_MAX 256       /* longest response line */
#endif
#ifndef SCPI_MAX_ARGS
#define SCPI_MAX_ARGS 16
#endif

/* Error codes (shared with the web/admin clients). */
enum {
    SCPI_OK                 = 0,
    SCPI_ERR_UNKNOWN_CMD    = 100,
    SCPI_ERR_LINE_TOO_LONG  = 101,
    SCPI_ERR_ARG_COUNT      = 102,
    SCPI_ERR_ARG_VALUE      = 103,
    SCPI_ERR_OUT_OF_RANGE   = 104,
    SCPI_ERR_NOT_IDLE       = 200,
    SCPI_ERR_NOT_RUNNING    = 201,
    SCPI_ERR_BUSY           = 202,
    SCPI_ERR_BAD_COOKIE     = 300,
    SCPI_ERR_FLASH          = 301,
    SCPI_ERR_ALREADY_DONE   = 302,
    SCPI_ERR_BAD_HEX        = 303,
    SCPI_ERR_TIMEOUT        = 304,
    SCPI_ERR_CRYPTO         = 400,
    SCPI_ERR_STORAGE        = 401,
    SCPI_ERR_NO_MEMORY      = 402,
    SCPI_ERR_ALREADY_PROV   = 403,
};

typedef struct scpi_ctx scpi_ctx_t;

typedef struct {
    uint8_t count;
    char*   argv[SCPI_MAX_ARGS];   /* NUL-terminated, point into the line buffer */
} scpi_args_t;

/*
 * Command handler. Return SCPI_OK and leave `out` empty to reply "OK", or fill
 * `out` with the reply line (query data, "OK <n>", ...). Return an error code to
 * reply ERR <code>,"<msg>": if `out` is non-empty it is used as the message,
 * otherwise the default text for the code.
 */
typedef int (*scpi_handler_fn)(scpi_ctx_t* ctx, const scpi_args_t* args, char* out, size_t out_cap);

typedef struct {
    const char*     name;      /* e.g. "*IDN?", "PROT:STAR" — matched case-insensitively, exact */
    scpi_handler_fn fn;
    uint8_t         scope;     /* transport mask, free for the application (0 = all) */
    uint8_t         flags;     /* free for the application (e.g. dev-only) */
} scpi_cmd_t;

/* Called once per response line. `line` has no terminator. */
typedef void (*scpi_emit_fn)(const char* line, void* arg);

/*
 * Optional gate: return non-zero to hide `cmd` for the current request (the
 * dispatcher then answers ERR 100 "unknown command"). Use it for transport
 * scoping and provisioning-mode gating.
 */
typedef int (*scpi_gate_fn)(const scpi_cmd_t* cmd, scpi_ctx_t* ctx);

struct scpi_ctx {
    char     line[SCPI_LINE_MAX];
    char     out[SCPI_OUT_MAX];
    uint16_t len;
    uint8_t  overflow;
    const scpi_cmd_t* table;
    size_t   table_len;
    scpi_gate_fn gate;
    void*    user;          /* application data (e.g. transport tag) */
};

void scpi_init(scpi_ctx_t* ctx, const scpi_cmd_t* table, size_t table_len, scpi_gate_fn gate, void* user);

/* Drop any partially received line (e.g. after a reconnect). */
void scpi_reset(scpi_ctx_t* ctx);

/*
 * Feed received bytes. For every completed line the command is dispatched and
 * `emit` is called once with the reply. Returns the number of lines completed.
 */
int scpi_feed(scpi_ctx_t* ctx, const uint8_t* data, size_t len, scpi_emit_fn emit, void* emit_arg);

/* Dispatch one already-assembled request line (no terminator). Reply in ctx->out; returns 1 if a reply was produced. */
int scpi_dispatch_line(scpi_ctx_t* ctx, char* line);

/* Format ERR <code>,"<msg>" into out. msg may be NULL for the default text. Returns length. */
int scpi_format_err(char* out, size_t cap, int code, const char* msg);

/* Default message for an error code. */
const char* scpi_err_text(int code);

/* Helpers for handlers. */
int  scpi_arg_int(const scpi_args_t* a, uint8_t i, long* v);      /* 1 on success */
int  scpi_arg_float(const scpi_args_t* a, uint8_t i, float* v);   /* 1 on success */
int  scpi_arg_eq(const scpi_args_t* a, uint8_t i, const char* s); /* case-insensitive compare */
int  scpi_strcaseeq(const char* a, const char* b);
/* Decode hex text into bytes; returns number of bytes or -1 on odd length / non-hex. */
int  scpi_hex_decode(const char* hex, uint8_t* out, size_t out_cap);
/* Append a quoted string ("" escaping) to out at *pos; returns 1 if it fit. */
int  scpi_out_quoted(char* out, size_t cap, size_t* pos, const char* s);

#ifdef __cplusplus
}
#endif

#endif /* SCPI_LINE_H */
