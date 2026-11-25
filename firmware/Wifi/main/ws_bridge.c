#include "ws_bridge.h"
#include "wifi.h"
#include "host_queue.h"

static const char *TAG = "ws_bridge";

// Accumulated screen input from WebSocket client
static volatile int8_t s_screen_rotary_adj = 0;
static volatile uint8_t s_screen_button_pressed = 0;

// Send one SCPI reply line (terminator included) to the /ws client as a text
// frame. Only ever called with the STM32's HOST_RESPONSE text or the ESP32's
// own ERR lines, so text framing is always valid.
void ws_send_to_client(const uint8_t *data, size_t len)
{
    if (s_ws_fd < 0 || s_server == NULL) {
        return;
    }

    httpd_ws_frame_t ws_pkt = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_TEXT,
        .payload = (uint8_t *)data,
        .len = len,
    };

    esp_err_t ret = httpd_ws_send_frame_async(s_server, s_ws_fd, &ws_pkt);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "WS send failed: %s", esp_err_to_name(ret));
        s_ws_fd = -1;  // Mark connection as closed
    }
}

// Since ESP-IDF v6.0 the URI handler is NOT called for the WebSocket handshake -
// httpd answers the upgrade itself and only dispatches the handler for
// subsequent frames. The gate and the fd capture therefore have to live in the
// pre/post handshake callbacks, otherwise s_ws_fd stays -1 and every send is
// silently dropped.
static esp_err_t ws_pre_handshake(httpd_req_t *req)
{
    // Only allow WebSocket in local mode. Returning an error here aborts the
    // upgrade before the protocol switch.
    if (!is_local_mode()) {
        ESP_LOGW(TAG, "WS rejected: not in local mode");
        return ESP_FAIL;
    }
    return ESP_OK;
}

static esp_err_t ws_post_handshake(httpd_req_t *req)
{
    s_ws_fd = httpd_req_to_sockfd(req);
    ESP_LOGI(TAG, "WS handshake, fd=%d", s_ws_fd);
    return ESP_OK;
}

// WebSocket handler for /ws - only reached for data frames now, never the
// handshake. Text or binary frames carry SCPI request lines; they are queued
// for the STM32 (HOST_POLL) and the replies come back through
// ws_send_to_client() (HOST_RESPONSE). Only registered on development-
// provisioned devices, see start_webserver().
esp_err_t ws_handler(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        return ESP_OK;
    }

    // Receive WebSocket frame (accept any type - binary or text)
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));

    // Get frame length first
    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "WS recv frame len failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ESP_LOGI(TAG, "WS recv: type=%d, len=%d", ws_pkt.type, (int)ws_pkt.len);

    if (ws_pkt.len > 0) {
        // Allocate buffer and receive payload
        ws_pkt.payload = malloc(ws_pkt.len);
        if (!ws_pkt.payload) {
            ESP_LOGE(TAG, "WS malloc failed");
            return ESP_ERR_NO_MEM;
        }

        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "WS recv frame failed: %s", esp_err_to_name(ret));
            free(ws_pkt.payload);
            return ret;
        }

        if (ws_pkt.type == HTTPD_WS_TYPE_TEXT || ws_pkt.type == HTTPD_WS_TYPE_BINARY) {
            host_queue_feed(HOST_TAG_LOCAL, ws_pkt.payload, ws_pkt.len);
        }

        free(ws_pkt.payload);
    }

    return ESP_OK;
}

const httpd_uri_t uri_ws = {
    .uri = "/ws",
    .method = HTTP_GET,
    .handler = ws_handler,
    .user_ctx = NULL,
    .is_websocket = true,
    .handle_ws_control_frames = false,
    .ws_pre_handshake_cb = ws_pre_handshake,
    .ws_post_handshake_cb = ws_post_handshake,
};

// Send screen text to /screen-ws client
void ws_send_screen_text(const char *text, size_t len)
{
    if (s_screen_ws_fd < 0 || s_server == NULL) {
        return;
    }

    httpd_ws_frame_t ws_pkt = {
        .final = true,
        .fragmented = false,
        .type = HTTPD_WS_TYPE_TEXT,
        .payload = (uint8_t *)text,
        .len = len,
    };

    esp_err_t ret = httpd_ws_send_frame_async(s_server, s_screen_ws_fd, &ws_pkt);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "Screen WS send failed: %s", esp_err_to_name(ret));
        s_screen_ws_fd = -1;
    }
}

// See the note on ws_pre_handshake(): since v6.0 this only runs for data frames.
static esp_err_t screen_ws_post_handshake(httpd_req_t *req)
{
    s_screen_ws_fd = httpd_req_to_sockfd(req);
    ESP_LOGI(TAG, "Screen WS handshake, fd=%d", s_screen_ws_fd);
    return ESP_OK;
}

// WebSocket handler for /screen-ws
static esp_err_t screen_ws_handler(httpd_req_t *req)
{
    if (req->method == HTTP_GET) {
        return ESP_OK;
    }

    // Receive binary input commands: 0=up, 1=down, 2=enter
    httpd_ws_frame_t ws_pkt;
    memset(&ws_pkt, 0, sizeof(httpd_ws_frame_t));

    esp_err_t ret = httpd_ws_recv_frame(req, &ws_pkt, 0);
    if (ret != ESP_OK) {
        return ret;
    }

    if (ws_pkt.len > 0) {
        ws_pkt.payload = malloc(ws_pkt.len);
        if (!ws_pkt.payload) {
            return ESP_ERR_NO_MEM;
        }
        ret = httpd_ws_recv_frame(req, &ws_pkt, ws_pkt.len);
        if (ret == ESP_OK && ws_pkt.len == 1) {
            uint8_t cmd = ws_pkt.payload[0];
            if (cmd == 0) {
                s_screen_rotary_adj--;
            } else if (cmd == 1) {
                s_screen_rotary_adj++;
            } else if (cmd == 2) {
                s_screen_button_pressed = 1;
            }
        }
        free(ws_pkt.payload);
        if (ret != ESP_OK) {
            return ret;
        }
    }

    return ESP_OK;
}

void ws_screen_consume_input(int8_t *rotary_adj, uint8_t *button_pressed)
{
    *rotary_adj = s_screen_rotary_adj;
    *button_pressed = s_screen_button_pressed;
    s_screen_rotary_adj = 0;
    s_screen_button_pressed = 0;
}

const httpd_uri_t uri_screen_ws = {
    .uri = "/screen-ws",
    .method = HTTP_GET,
    .handler = screen_ws_handler,
    .user_ctx = NULL,
    .is_websocket = true,
    .handle_ws_control_frames = false,
    .ws_post_handshake_cb = screen_ws_post_handshake,
};
