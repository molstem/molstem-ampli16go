/*
 * scpi_line — minimal SCPI-style line protocol parser/dispatcher.
 * Canonical copy: firmware/common/scpi/scpi_line.c (see scpi_line.h).
 */
#include "scpi_line.h"

#include <ctype.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

void scpi_init(scpi_ctx_t* ctx, const scpi_cmd_t* table, size_t table_len, scpi_gate_fn gate, void* user)
{
    memset(ctx, 0, sizeof(*ctx));
    ctx->table = table;
    ctx->table_len = table_len;
    ctx->gate = gate;
    ctx->user = user;
}

void scpi_reset(scpi_ctx_t* ctx)
{
    ctx->len = 0;
    ctx->overflow = 0;
}

const char* scpi_err_text(int code)
{
    switch (code) {
    case SCPI_ERR_UNKNOWN_CMD:   return "unknown command";
    case SCPI_ERR_LINE_TOO_LONG: return "line too long";
    case SCPI_ERR_ARG_COUNT:     return "bad argument count";
    case SCPI_ERR_ARG_VALUE:     return "bad argument value";
    case SCPI_ERR_OUT_OF_RANGE:  return "out of range";
    case SCPI_ERR_NOT_IDLE:      return "not idle";
    case SCPI_ERR_NOT_RUNNING:   return "not running";
    case SCPI_ERR_BUSY:          return "busy";
    case SCPI_ERR_BAD_COOKIE:    return "bad cookie";
    case SCPI_ERR_FLASH:         return "flash error";
    case SCPI_ERR_ALREADY_DONE:  return "already done";
    case SCPI_ERR_BAD_HEX:       return "bad hex";
    case SCPI_ERR_TIMEOUT:       return "internal timeout";
    case SCPI_ERR_CRYPTO:        return "crypto error";
    case SCPI_ERR_STORAGE:       return "storage error";
    case SCPI_ERR_NO_MEMORY:     return "out of memory";
    case SCPI_ERR_ALREADY_PROV:  return "already provisioned";
    default:                     return "error";
    }
}

int scpi_format_err(char* out, size_t cap, int code, const char* msg)
{
    size_t pos = 0;
    int n;
    if (!msg || !*msg) {
        msg = scpi_err_text(code);
    }
    n = snprintf(out, cap, "ERR %d,", code);
    if (n < 0) {
        return 0;
    }
    pos = (size_t)n < cap ? (size_t)n : cap - 1;
    scpi_out_quoted(out, cap, &pos, msg);
    return (int)pos;
}

int scpi_strcaseeq(const char* a, const char* b)
{
    while (*a && *b) {
        if (toupper((unsigned char)*a) != toupper((unsigned char)*b)) {
            return 0;
        }
        a++;
        b++;
    }
    return *a == '\0' && *b == '\0';
}

int scpi_arg_eq(const scpi_args_t* a, uint8_t i, const char* s)
{
    return i < a->count && scpi_strcaseeq(a->argv[i], s);
}

int scpi_arg_int(const scpi_args_t* a, uint8_t i, long* v)
{
    char* end;
    if (i >= a->count || a->argv[i][0] == '\0') {
        return 0;
    }
    *v = strtol(a->argv[i], &end, 10);
    return *end == '\0';
}

int scpi_arg_float(const scpi_args_t* a, uint8_t i, float* v)
{
    char* end;
    if (i >= a->count || a->argv[i][0] == '\0') {
        return 0;
    }
    *v = strtof(a->argv[i], &end);
    return *end == '\0';
}

static int hex_nibble(char c)
{
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

int scpi_hex_decode(const char* hex, uint8_t* out, size_t out_cap)
{
    size_t n = strlen(hex);
    size_t i;
    if (n == 0 || (n & 1) || n / 2 > out_cap) {
        return -1;
    }
    for (i = 0; i < n; i += 2) {
        int hi = hex_nibble(hex[i]);
        int lo = hex_nibble(hex[i + 1]);
        if (hi < 0 || lo < 0) {
            return -1;
        }
        out[i / 2] = (uint8_t)((hi << 4) | lo);
    }
    return (int)(n / 2);
}

int scpi_out_quoted(char* out, size_t cap, size_t* pos, const char* s)
{
    size_t p = *pos;
    if (p + 2 >= cap) {
        return 0;
    }
    out[p++] = '"';
    for (; *s; s++) {
        size_t need = (*s == '"') ? 2 : 1;
        if (p + need + 1 >= cap) {           /* keep room for closing quote + NUL */
            break;
        }
        if (*s == '"') {
            out[p++] = '"';
        }
        out[p++] = (*s == '\r' || *s == '\n') ? ' ' : *s;
    }
    out[p++] = '"';
    out[p] = '\0';
    *pos = p;
    return 1;
}

/* Split `rest` (text after the header) into comma separated, optionally quoted arguments, in place. */
static int tokenize_args(char* rest, scpi_args_t* args)
{
    char* p = rest;
    args->count = 0;

    while (*p == ' ' || *p == '\t') p++;
    if (*p == '\0') {
        return 1;
    }

    for (;;) {
        char* start;
        char* w;
        if (args->count >= SCPI_MAX_ARGS) {
            return 0;
        }
        while (*p == ' ' || *p == '\t') p++;

        if (*p == '"') {
            /* quoted argument: unescape "" in place */
            p++;
            start = w = p;
            for (;;) {
                if (*p == '\0') {
                    return 0;                  /* unterminated quote */
                }
                if (*p == '"') {
                    if (p[1] == '"') {
                        *w++ = '"';
                        p += 2;
                        continue;
                    }
                    p++;
                    break;
                }
                *w++ = *p++;
            }
            *w = '\0';
            while (*p == ' ' || *p == '\t') p++;
        } else {
            char* end;
            start = p;
            while (*p && *p != ',') p++;
            end = p;
            while (end > start && (end[-1] == ' ' || end[-1] == '\t')) end--;
            if (*p == ',') {
                *end = '\0';
                args->argv[args->count++] = start;
                p++;
                continue;
            }
            *end = '\0';
            args->argv[args->count++] = start;
            return 1;
        }

        args->argv[args->count++] = start;

        if (*p == ',') {
            p++;
            continue;
        }
        if (*p == '\0') {
            return 1;
        }
        return 0;                              /* garbage after a quoted argument */
    }
}

int scpi_dispatch_line(scpi_ctx_t* ctx, char* line)
{
    char* p = line;
    char* header;
    char* rest;
    scpi_args_t args;
    size_t i;
    const scpi_cmd_t* cmd = NULL;
    int rc;

    while (*p == ' ' || *p == '\t') p++;
    if (*p == '\0') {
        return 0;                              /* empty line: no reply */
    }
    header = p;
    while (*p && *p != ' ' && *p != '\t') p++;
    if (*p) {
        *p++ = '\0';
    }
    rest = p;

    for (i = 0; i < ctx->table_len; i++) {
        if (scpi_strcaseeq(ctx->table[i].name, header)) {
            if (ctx->gate && ctx->gate(&ctx->table[i], ctx)) {
                continue;                      /* hidden on this transport/mode */
            }
            cmd = &ctx->table[i];
            break;
        }
    }

    ctx->out[0] = '\0';
    if (!cmd) {
        scpi_format_err(ctx->out, sizeof(ctx->out), SCPI_ERR_UNKNOWN_CMD, NULL);
        return 1;
    }
    if (!tokenize_args(rest, &args)) {
        scpi_format_err(ctx->out, sizeof(ctx->out), SCPI_ERR_ARG_VALUE, "malformed arguments");
        return 1;
    }

    rc = cmd->fn(ctx, &args, ctx->out, sizeof(ctx->out));
    if (rc != SCPI_OK) {
        char msg[SCPI_OUT_MAX];
        strncpy(msg, ctx->out, sizeof(msg) - 1);
        msg[sizeof(msg) - 1] = '\0';
        scpi_format_err(ctx->out, sizeof(ctx->out), rc, msg);
    } else if (ctx->out[0] == '\0') {
        strcpy(ctx->out, "OK");
    }
    return 1;
}

int scpi_feed(scpi_ctx_t* ctx, const uint8_t* data, size_t len, scpi_emit_fn emit, void* emit_arg)
{
    int lines = 0;
    size_t i;

    for (i = 0; i < len; i++) {
        char c = (char)data[i];

        if (c == '\r') {
            continue;                          /* CRLF: the LF terminates */
        }
        if (c == '\n') {
            if (ctx->overflow) {
                ctx->overflow = 0;
                ctx->len = 0;
                scpi_format_err(ctx->out, sizeof(ctx->out), SCPI_ERR_LINE_TOO_LONG, NULL);
                emit(ctx->out, emit_arg);
                lines++;
                continue;
            }
            ctx->line[ctx->len] = '\0';
            ctx->len = 0;
            if (scpi_dispatch_line(ctx, ctx->line)) {
                emit(ctx->out, emit_arg);
                lines++;
            }
            continue;
        }

        if (ctx->overflow) {
            continue;
        }
        if (ctx->len >= SCPI_LINE_MAX - 1) {
            ctx->overflow = 1;
            continue;
        }
        ctx->line[ctx->len++] = c;
    }
    return lines;
}
