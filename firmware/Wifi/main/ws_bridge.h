#pragma once

#include "config.h"

void uart_init(void);
void ws_send_to_client(const uint8_t *data, size_t len);
esp_err_t ws_handler(httpd_req_t *req);

extern const httpd_uri_t uri_ws;
extern const httpd_uri_t uri_screen_ws;

void ws_send_screen_text(const char *text, size_t len);
void ws_screen_consume_input(int8_t *rotary_adj, uint8_t *button_pressed);
