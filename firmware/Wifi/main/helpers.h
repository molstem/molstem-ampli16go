#pragma once

#include "config.h"

void safe_strcpy(char *dest, const char *src, size_t dest_size);
void encode_base32(const uint8_t *data, size_t data_len, char *out, size_t out_len);
void generate_random_serial(char *serial, size_t len);
int base64_decode(const char *in, size_t in_len, char *out, size_t out_len);
bool check_local_auth(httpd_req_t *req);
esp_err_t send_json_response(httpd_req_t *req, const char *json);
esp_err_t send_json_success(httpd_req_t *req);
esp_err_t send_json_error(httpd_req_t *req, const char *message);
esp_err_t parse_json_body(httpd_req_t *req, char *buf, size_t buf_len);
bool json_get_string(const char *json, const char *key, char *value, size_t value_len);
