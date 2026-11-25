#include "helpers.h"

// Safe string copy that always null-terminates
void safe_strcpy(char *dest, const char *src, size_t dest_size)
{
    if (dest_size == 0) return;
    size_t i;
    for (i = 0; i < dest_size - 1 && src[i] != '\0'; i++) {
        dest[i] = src[i];
    }
    dest[i] = '\0';
}

// Crockford's base32 alphabet (excludes I, L, O, U to avoid confusion)
static const char BASE32_ALPHABET[] = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

void encode_base32(const uint8_t *data, size_t data_len, char *out, size_t out_len)
{
    // Encode bytes to Crockford's base32
    // 128 bits = 16 bytes = 26 base32 characters (with 2 bits padding)
    size_t out_idx = 0;
    uint64_t buffer = 0;
    int bits_in_buffer = 0;

    for (size_t i = 0; i < data_len && out_idx < out_len - 1; i++) {
        buffer = (buffer << 8) | data[i];
        bits_in_buffer += 8;

        while (bits_in_buffer >= 5 && out_idx < out_len - 1) {
            bits_in_buffer -= 5;
            out[out_idx++] = BASE32_ALPHABET[(buffer >> bits_in_buffer) & 0x1F];
        }
    }

    // Handle remaining bits (if any)
    if (bits_in_buffer > 0 && out_idx < out_len - 1) {
        out[out_idx++] = BASE32_ALPHABET[(buffer << (5 - bits_in_buffer)) & 0x1F];
    }

    out[out_idx] = '\0';
}

// Base64 decoding table
static const int8_t BASE64_DECODE[] = {
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
    -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
    52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,
    -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
    15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
    -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
    41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1
};

int base64_decode(const char *in, size_t in_len, char *out, size_t out_len)
{
    size_t i, j = 0;
    uint32_t acc = 0;
    int bits = 0;

    for (i = 0; i < in_len && j < out_len; i++) {
        unsigned char c = (unsigned char)in[i];
        if (c == '=') break;
        if (c >= 128 || BASE64_DECODE[c] < 0) continue;

        acc = (acc << 6) | BASE64_DECODE[c];
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[j++] = (char)((acc >> bits) & 0xFF);
        }
    }
    if (j < out_len) out[j] = '\0';
    return (int)j;
}

// Check HTTP Basic Auth for local mode
bool check_local_auth(httpd_req_t *req)
{
    char auth_header[256] = {0};
    size_t auth_len = httpd_req_get_hdr_value_len(req, "Authorization");

    if (auth_len == 0 || auth_len >= sizeof(auth_header)) {
        goto unauthorized;
    }

    if (httpd_req_get_hdr_value_str(req, "Authorization", auth_header, sizeof(auth_header)) != ESP_OK) {
        goto unauthorized;
    }

    // Check for "Basic " prefix
    if (strncmp(auth_header, "Basic ", 6) != 0) {
        goto unauthorized;
    }

    // Decode base64 credentials
    char decoded[128] = {0};
    int decoded_len = base64_decode(auth_header + 6, strlen(auth_header + 6), decoded, sizeof(decoded) - 1);
    if (decoded_len <= 0) {
        goto unauthorized;
    }

    // Find the colon separator (username:password)
    char *colon = strchr(decoded, ':');
    if (!colon) {
        goto unauthorized;
    }

    *colon = '\0';
    const char *username = decoded;
    const char *password = colon + 1;

    (void)username;
    // Check credentials: username is ignored, password is device password
    if (strcmp(password, s_device_password) == 0) {
        return true;
    }

unauthorized:
    httpd_resp_set_status(req, "401 Unauthorized");
    httpd_resp_set_hdr(req, "WWW-Authenticate", "Basic realm=\"molstem\"");
    httpd_resp_send(req, "Unauthorized", HTTPD_RESP_USE_STRLEN);
    return false;
}

// Simple JSON response helpers
esp_err_t send_json_response(httpd_req_t *req, const char *json)
{
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    return httpd_resp_send(req, json, HTTPD_RESP_USE_STRLEN);
}

esp_err_t send_json_success(httpd_req_t *req)
{
    return send_json_response(req, "{\"status\":\"success\"}");
}

esp_err_t send_json_error(httpd_req_t *req, const char *message)
{
    char buf[256];
    snprintf(buf, sizeof(buf), "{\"status\":\"error\",\"message\":\"%s\"}", message);
    return send_json_response(req, buf);
}

// Parse JSON body (simple key-value extraction)
esp_err_t parse_json_body(httpd_req_t *req, char *buf, size_t buf_len)
{
    int content_len = req->content_len;
    if (content_len <= 0 || content_len >= (int)buf_len) {
        return ESP_FAIL;
    }

    int received = httpd_req_recv(req, buf, content_len);
    if (received != content_len) {
        return ESP_FAIL;
    }
    buf[received] = '\0';
    return ESP_OK;
}

// Extract string value from JSON (simple implementation)
bool json_get_string(const char *json, const char *key, char *value, size_t value_len)
{
    char search[64];
    snprintf(search, sizeof(search), "\"%s\"", key);

    const char *key_pos = strstr(json, search);
    if (!key_pos) return false;

    const char *colon = strchr(key_pos + strlen(search), ':');
    if (!colon) return false;

    // Skip whitespace
    const char *p = colon + 1;
    while (*p == ' ' || *p == '\t') p++;

    if (*p != '"') return false;
    p++; // Skip opening quote

    size_t i = 0;
    while (*p && *p != '"' && i < value_len - 1) {
        if (*p == '\\' && *(p + 1)) {
            p++; // Skip backslash
            switch (*p) {
                case 'n': value[i++] = '\n'; p++; break;
                case 'r': value[i++] = '\r'; p++; break;
                case 't': value[i++] = '\t'; p++; break;
                case '"': value[i++] = '"';  p++; break;
                case '\\': value[i++] = '\\'; p++; break;
                default: value[i++] = *p++; break;
            }
        } else {
            value[i++] = *p++;
        }
    }
    value[i] = '\0';
    return true;
}
