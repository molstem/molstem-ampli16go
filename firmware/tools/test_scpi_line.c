/*
 * Host unit test for firmware/common/scpi/scpi_line.c
 * Build & run:  python firmware/tools/test_scpi.py
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "scpi_line.h"

static char last_reply[8][SCPI_OUT_MAX];
static int reply_count;

static void emit(const char* line, void* arg)
{
    (void)arg;
    if (reply_count < 8) {
        strcpy(last_reply[reply_count], line);
    }
    reply_count++;
}

static int h_idn(scpi_ctx_t* c, const scpi_args_t* a, char* out, size_t cap)
{
    (void)c; (void)a;
    snprintf(out, cap, "molstem,test,SER,v1");
    return SCPI_OK;
}

static int h_ok(scpi_ctx_t* c, const scpi_args_t* a, char* out, size_t cap)
{
    (void)c; (void)a; (void)out; (void)cap;
    return SCPI_OK;
}

static int h_echo(scpi_ctx_t* c, const scpi_args_t* a, char* out, size_t cap)
{
    size_t pos = 0;
    uint8_t i;
    (void)c;
    for (i = 0; i < a->count; i++) {
        if (i) out[pos++] = '|';
        scpi_out_quoted(out, cap, &pos, a->argv[i]);
    }
    if (a->count == 0) snprintf(out, cap, "<none>");
    return SCPI_OK;
}

static int h_range(scpi_ctx_t* c, const scpi_args_t* a, char* out, size_t cap)
{
    long v;
    (void)c;
    if (a->count != 1) return SCPI_ERR_ARG_COUNT;
    if (!scpi_arg_int(a, 0, &v)) return SCPI_ERR_ARG_VALUE;
    if (v > 10) { snprintf(out, cap, "value %ld too big", v); return SCPI_ERR_OUT_OF_RANGE; }
    snprintf(out, cap, "OK %ld", v);
    return SCPI_OK;
}

static int h_hex(scpi_ctx_t* c, const scpi_args_t* a, char* out, size_t cap)
{
    uint8_t buf[64];
    int n;
    (void)c;
    if (a->count != 1) return SCPI_ERR_ARG_COUNT;
    n = scpi_hex_decode(a->argv[0], buf, sizeof(buf));
    if (n < 0) return SCPI_ERR_BAD_HEX;
    snprintf(out, cap, "OK %d %02x%02x", n, buf[0], buf[n - 1]);
    return SCPI_OK;
}

static int gate(const scpi_cmd_t* cmd, scpi_ctx_t* ctx)
{
    return (cmd->flags & 1) && *(int*)ctx->user == 0;   /* flag 1 = dev-only; user = dev mode */
}

static const scpi_cmd_t table[] = {
    { "*IDN?",     h_idn,   0, 0 },
    { "PROT:STOP", h_ok,    0, 0 },
    { "ECHO",      h_echo,  0, 0 },
    { "RANGE",     h_range, 0, 0 },
    { "HEX",       h_hex,   0, 0 },
    { "LCD?",      h_idn,   0, 1 },
};

static int failures;
#define CHECK(cond) do { if (!(cond)) { printf("FAIL line %d: %s\n", __LINE__, #cond); failures++; } } while (0)

static void feed_str(scpi_ctx_t* ctx, const char* s)
{
    scpi_feed(ctx, (const uint8_t*)s, strlen(s), emit, NULL);
}

int main(void)
{
    scpi_ctx_t ctx;
    int dev = 1;
    scpi_init(&ctx, table, sizeof(table) / sizeof(table[0]), gate, &dev);

    /* basic query, case-insensitive, CRLF */
    reply_count = 0; feed_str(&ctx, "*idn?\r\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "molstem,test,SER,v1") == 0);

    /* command with empty out -> OK */
    reply_count = 0; feed_str(&ctx, "prot:stop\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "OK") == 0);

    /* unknown */
    reply_count = 0; feed_str(&ctx, "NOPE 1\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "ERR 100,\"unknown command\"") == 0);

    /* empty lines ignored, two lines in one packet, split across packets */
    reply_count = 0; feed_str(&ctx, "\n\n*IDN?\nPROT:ST"); feed_str(&ctx, "OP\n");
    CHECK(reply_count == 2 && strcmp(last_reply[1], "OK") == 0);

    /* quoted args with commas and escaped quotes, mixed with numbers and spaces */
    reply_count = 0; feed_str(&ctx, "ECHO \"a, b\",  12 , \"say \"\"hi\"\"\" ,x\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "\"a, b\"|\"12\"|\"say \"\"hi\"\"\"|\"x\"") == 0);

    /* no args */
    reply_count = 0; feed_str(&ctx, "ECHO\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "<none>") == 0);

    /* unterminated quote -> ERR 103 */
    reply_count = 0; feed_str(&ctx, "ECHO \"open\n");
    CHECK(reply_count == 1 && strncmp(last_reply[0], "ERR 103,", 8) == 0);

    /* argument validation paths */
    reply_count = 0; feed_str(&ctx, "RANGE 5\nRANGE 50\nRANGE x\nRANGE 1,2\n");
    CHECK(reply_count == 4);
    CHECK(strcmp(last_reply[0], "OK 5") == 0);
    CHECK(strcmp(last_reply[1], "ERR 104,\"value 50 too big\"") == 0);
    CHECK(strcmp(last_reply[2], "ERR 103,\"bad argument value\"") == 0);
    CHECK(strcmp(last_reply[3], "ERR 102,\"bad argument count\"") == 0);

    /* hex */
    reply_count = 0; feed_str(&ctx, "HEX 6d6f6c7374656d66773100\nHEX abc\nHEX zz\n");
    CHECK(reply_count == 3);
    CHECK(strcmp(last_reply[0], "OK 11 6d00") == 0);
    CHECK(strncmp(last_reply[1], "ERR 303,", 8) == 0);
    CHECK(strncmp(last_reply[2], "ERR 303,", 8) == 0);

    /* gate: dev-only command hidden when dev == 0 */
    reply_count = 0; feed_str(&ctx, "LCD?\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "molstem,test,SER,v1") == 0);
    dev = 0;
    reply_count = 0; feed_str(&ctx, "LCD?\n");
    CHECK(reply_count == 1 && strncmp(last_reply[0], "ERR 100,", 8) == 0);
    dev = 1;

    /* overflow: > SCPI_LINE_MAX without newline, then recovers */
    {
        char big[SCPI_LINE_MAX + 50];
        memset(big, 'A', sizeof(big) - 1);
        big[sizeof(big) - 1] = '\0';
        reply_count = 0; feed_str(&ctx, big); feed_str(&ctx, "\n*IDN?\n");
        CHECK(reply_count == 2);
        CHECK(strcmp(last_reply[0], "ERR 101,\"line too long\"") == 0);
        CHECK(strcmp(last_reply[1], "molstem,test,SER,v1") == 0);
    }

    /* scpi_reset drops a partial line */
    reply_count = 0; feed_str(&ctx, "*ID"); scpi_reset(&ctx); feed_str(&ctx, "*IDN?\n");
    CHECK(reply_count == 1 && strcmp(last_reply[0], "molstem,test,SER,v1") == 0);

    if (failures) {
        printf("%d failure(s)\n", failures);
        return 1;
    }
    printf("all scpi_line tests passed\n");
    return 0;
}
