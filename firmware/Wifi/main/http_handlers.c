#include "http_handlers.h"
#include "helpers.h"
#include "wifi.h"
#include "cloud.h"
#include "nvs_config.h"
#include "ws_bridge.h"
#include "log_capture.h"

static const char *TAG = "http";

// GET / - Serve appropriate HTML page based on device state
static esp_err_t index_get_handler(httpd_req_t *req)
{
    const char *start;
    uint32_t len;

    if (is_configuration_mode()) {
        // Configuration mode: serve captive portal setup page
        start = index_start;
        len = index_end - index_start;
        ESP_LOGI(TAG, "Serve index.html (%lu bytes gzipped)", (unsigned long)len);
    } else if (is_local_mode()) {
        // Local mode: require authentication
        if (!check_local_auth(req)) {
            return ESP_OK;  // 401 already sent
        }
        // Serve main app
        start = index_app_start;
        len = index_app_end - index_app_start;
        ESP_LOGI(TAG, "Serve index-app.html (%lu bytes gzipped)", (unsigned long)len);
    } else {
        // Cloud mode: no local web UI
        httpd_resp_set_status(req, "403 Forbidden");
        httpd_resp_set_type(req, "text/plain");
        return httpd_resp_send(req, "Device is in cloud mode", HTTPD_RESP_USE_STRLEN);
    }

    httpd_resp_set_type(req, "text/html");
    httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    return httpd_resp_send(req, start, len);
}

// GET /favicon.png
static esp_err_t favicon_get_handler(httpd_req_t *req)
{
    const uint32_t len = favicon_end - favicon_start;
    httpd_resp_set_type(req, "image/png");
    return httpd_resp_send(req, favicon_start, len);
}

// GET /screen
static esp_err_t screen_get_handler(httpd_req_t *req)
{
    const uint32_t len = screen_html_end - screen_html_start;
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, screen_html_start, len);
}

// GET /api/wifi-scan
static esp_err_t api_wifi_scan_handler(httpd_req_t *req)
{
    if (!is_configuration_mode()) {
        httpd_resp_set_status(req, "403 Forbidden");
        return send_json_error(req, "Not in configuration mode");
    }

    ESP_LOGI(TAG, "API: wifi-scan");

    wifi_ap_record_t *ap_records = malloc(sizeof(wifi_ap_record_t) * MAX_WIFI_SCAN_RESULTS);
    if (!ap_records) {
        return send_json_error(req, "Out of memory");
    }

    uint16_t ap_count = MAX_WIFI_SCAN_RESULTS;
    esp_err_t err = wifi_scan(ap_records, &ap_count);

    if (err != ESP_OK) {
        free(ap_records);
        return send_json_error(req, "WiFi scan failed");
    }

    // Build JSON response
    char *json = malloc(JSON_BUFFER_SIZE);
    if (!json) {
        free(ap_records);
        return send_json_error(req, "Out of memory");
    }

    int offset = snprintf(json, JSON_BUFFER_SIZE, "{\"status\":\"success\",\"networks\":[");

    // Track unique SSIDs to avoid duplicates
    for (int i = 0; i < ap_count && offset < JSON_BUFFER_SIZE - 100; i++) {
        if (ap_records[i].ssid[0] == '\0') continue; // Skip hidden networks

        // Check for duplicate SSID (keep strongest signal)
        bool duplicate = false;
        for (int j = 0; j < i; j++) {
            if (strcmp((char *)ap_records[i].ssid, (char *)ap_records[j].ssid) == 0) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) continue;

        if (offset > 50) { // Not first entry
            offset += snprintf(json + offset, JSON_BUFFER_SIZE - offset, ",");
        }

        bool secure = ap_records[i].authmode != WIFI_AUTH_OPEN;
        offset += snprintf(json + offset, JSON_BUFFER_SIZE - offset,
                          "{\"ssid\":\"%s\",\"rssi\":%d,\"secure\":%s}",
                          ap_records[i].ssid,
                          ap_records[i].rssi,
                          secure ? "true" : "false");
    }

    snprintf(json + offset, JSON_BUFFER_SIZE - offset, "]}");

    esp_err_t result = send_json_response(req, json);
    free(json);
    free(ap_records);
    return result;
}

// POST /api/host-setup
static esp_err_t api_host_setup_handler(httpd_req_t *req)
{
    if (!is_configuration_mode()) {
        httpd_resp_set_status(req, "403 Forbidden");
        return send_json_error(req, "Not in configuration mode");
    }

    ESP_LOGI(TAG, "API: host-setup");

    char *buf = malloc(512);
    if (!buf) {
        return send_json_error(req, "Out of memory");
    }

    if (parse_json_body(req, buf, 512) != ESP_OK) {
        free(buf);
        return send_json_error(req, "Invalid request body");
    }

    char mode[16] = {0};
    char device_name[64] = {0};
    char password[64] = {0};

    json_get_string(buf, "mode", mode, sizeof(mode));
    json_get_string(buf, "deviceName", device_name, sizeof(device_name));
    json_get_string(buf, "password", password, sizeof(password));

    free(buf);

    // Validate mode
    if (strcmp(mode, "local") != 0 && strcmp(mode, "cloud") != 0) {
        return send_json_error(req, "Invalid mode. Must be 'local' or 'cloud'.");
    }

    // Validate device name
    if (strlen(device_name) < 1 || strlen(device_name) > 63) {
        return send_json_error(req, "Device name must be 1-63 characters.");
    }

    // Validate password for local mode
    if (strcmp(mode, "local") == 0 && strlen(password) < 6) {
        return send_json_error(req, "Password must be at least 6 characters for local mode.");
    }

    // Save configuration
    safe_strcpy(s_setup_mode, mode, sizeof(s_setup_mode));
    safe_strcpy(s_device_name, device_name, sizeof(s_device_name));
    safe_strcpy(s_device_password, password, sizeof(s_device_password));

    ESP_LOGI(TAG, "Host setup: mode=%s, name=%s", s_setup_mode, s_device_name);

    return send_json_success(req);
}

// POST /api/wifi-setup
static esp_err_t api_wifi_setup_handler(httpd_req_t *req)
{
    if (!is_configuration_mode()) {
        httpd_resp_set_status(req, "403 Forbidden");
        return send_json_error(req, "Not in configuration mode");
    }

    ESP_LOGI(TAG, "API: wifi-setup");

    char *buf = malloc(512);
    if (!buf) {
        return send_json_error(req, "Out of memory");
    }

    if (parse_json_body(req, buf, 512) != ESP_OK) {
        free(buf);
        return send_json_error(req, "Invalid request body");
    }

    char ssid[33] = {0};
    char password[64] = {0};
    char region[32] = {0};
    char timezone[64] = {0};

    json_get_string(buf, "ssid", ssid, sizeof(ssid));
    json_get_string(buf, "password", password, sizeof(password));
    json_get_string(buf, "region", region, sizeof(region));
    json_get_string(buf, "timezone", timezone, sizeof(timezone));

    free(buf);

    // Validate
    if (strlen(ssid) == 0) {
        return send_json_error(req, "SSID is required.");
    }

    if (strlen(region) == 0) {
        return send_json_error(req, "Region is required.");
    }

    if (strlen(timezone) == 0) {
        return send_json_error(req, "Timezone is required.");
    }

    ESP_LOGI(TAG, "WiFi setup: ssid=%s, region=%s, timezone=%s", ssid, region, timezone);

    // Attempt to connect
    esp_err_t err = wifi_connect_sta(ssid, password);

    if (err != ESP_OK) {
        return send_json_error(req, "Failed to connect to WiFi. Check password and try again.");
    }

    // Stop captive portal DNS so real DNS resolution works (e.g., for NTP, cloud API)
    if (s_dns_server) {
        stop_dns_server(s_dns_server);
        s_dns_server = NULL;
    }

    // Save WiFi credentials for reconnection on boot
    safe_strcpy(s_wifi_ssid, ssid, sizeof(s_wifi_ssid));
    safe_strcpy(s_wifi_password, password, sizeof(s_wifi_password));

    // Save region and timezone
    nvs_save_string(NVS_KEY_REGION, region);
    nvs_save_string(NVS_KEY_TIMEZONE, timezone);

    // For cloud mode, register with cloud and get enrollment ID
    if (strcmp(s_setup_mode, "cloud") == 0) {
        ESP_LOGI(TAG, "Cloud mode: syncing time and registering...");

        // Sync time via SNTP (required for valid signatures)
        err = sntp_init_time();
        if (err != ESP_OK) {
            return send_json_error(req, "Failed to sync time via NTP. Check internet connection.");
        }

        err = cloud_crypto_init();
        if (err != ESP_OK) {
            return send_json_error(req, "Failed to initialize cloud crypto.");
        }

        err = cloud_register();
        if (err != ESP_OK || (s_cloud_enrollment_id[0] == '\0' && !s_cloud_enrolled)) {
            return send_json_error(req, "Failed to register with cloud. Check internet connection.");
        }

        // Start WebSocket connection
        err = cloud_ws_connect();
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "WebSocket connect failed, will retry on next boot");
        }

        ESP_LOGI(TAG, "Cloud registration successful: %s",
                 s_cloud_enrolled ? "(already enrolled)" : s_cloud_enrollment_id);
    } else {
        // Local mode: start mDNS
        start_mdns_service();
        ESP_LOGI(TAG, "Local mode: started mDNS");
    }

    return send_json_success(req);
}

// GET /api/status
static esp_err_t api_status_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "API: status (connected=%d, mode=%s)", s_wifi_connected, s_setup_mode);

    char json[512];

    if (!s_wifi_connected) {
        snprintf(json, sizeof(json),
                 "{\"status\":\"success\",\"state\":\"disconnected\",\"id\":\"%s\"}",
                 s_device_serial);
    } else if (strcmp(s_setup_mode, "cloud") == 0) {
        if (s_cloud_enrollment_id[0] != '\0') {
            snprintf(json, sizeof(json),
                     "{\"status\":\"success\",\"state\":\"cloud\",\"id\":\"%s\",\"link\":\"%s\",\"enrolled\":false}",
                     s_device_serial, s_cloud_enrollment_id);
        } else if (s_cloud_enrolled) {
            snprintf(json, sizeof(json),
                     "{\"status\":\"success\",\"state\":\"cloud\",\"id\":\"%s\",\"enrolled\":true}",
                     s_device_serial);
        } else {
            snprintf(json, sizeof(json),
                     "{\"status\":\"success\",\"state\":\"cloud\",\"id\":\"%s\"}",
                     s_device_serial);
        }
    } else {
        // Local mode
        char mdns_link[80];
        snprintf(mdns_link, sizeof(mdns_link), "http://%s.local", s_device_name);

        // Convert to lowercase
        for (char *p = mdns_link + 7; *p && *p != '.'; p++) {
            if (*p >= 'A' && *p <= 'Z') *p += 32;
        }

        snprintf(json, sizeof(json),
                 "{\"status\":\"success\",\"state\":\"local\",\"id\":\"%s\",\"link\":\"%s\",\"ip\":\"%s\"}",
                 s_device_serial, mdns_link, s_sta_ip);
    }

    return send_json_response(req, json);
}

// Task to switch from APSTA to STA mode after delay
static void switch_to_sta_task(void *arg)
{
    vTaskDelay(pdMS_TO_TICKS(2000));
    ESP_LOGI(TAG, "Switching from APSTA to STA-only mode");
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    vTaskDelete(NULL);
}

// POST /api/commit
static esp_err_t api_commit_handler(httpd_req_t *req)
{
    if (!is_configuration_mode()) {
        httpd_resp_set_status(req, "403 Forbidden");
        return send_json_error(req, "Not in configuration mode");
    }

    // For cloud mode, ensure we have a valid enrollment ID before committing
    if (strcmp(s_setup_mode, "cloud") == 0) {
        if (s_cloud_enrollment_id[0] == '\0' && !s_cloud_enrolled) {
            return send_json_error(req, "Cloud registration not complete. Cannot commit.");
        }
    }

    ESP_LOGI(TAG, "API: commit - finalizing setup");

    s_setup_committed = true;

    // Save all configuration to NVS
    nvs_save_config();

    // Stop DNS server (no more captive portal redirection)
    if (s_dns_server) {
        ESP_LOGI(TAG, "Stopping DNS server");
        stop_dns_server(s_dns_server);
        s_dns_server = NULL;
    }

    // Schedule switch to STA-only mode after 2 seconds
    xTaskCreate(switch_to_sta_task, "sta_switch", 2048, NULL, 5, NULL);

    return send_json_success(req);
}

// 404 handler - redirect to root for captive portal (only in configuration mode)
static esp_err_t http_404_error_handler(httpd_req_t *req, httpd_err_code_t err)
{
    if (is_configuration_mode()) {
        httpd_resp_set_status(req, "303 See Other");
        httpd_resp_set_hdr(req, "Location", "/");
        // iOS requires content to detect captive portal
        httpd_resp_send(req, "Redirect to captive portal", HTTPD_RESP_USE_STRLEN);
    } else {
        httpd_resp_set_status(req, "404 Not Found");
        httpd_resp_send(req, "Not Found", HTTPD_RESP_USE_STRLEN);
    }
    return ESP_OK;
}

// ============ HTTP Server ============

static const httpd_uri_t uri_index = {
    .uri = "/",
    .method = HTTP_GET,
    .handler = index_get_handler,
};

static const httpd_uri_t uri_favicon = {
    .uri = "/favicon.png",
    .method = HTTP_GET,
    .handler = favicon_get_handler,
};

static const httpd_uri_t uri_screen = {
    .uri = "/screen",
    .method = HTTP_GET,
    .handler = screen_get_handler,
};

static const httpd_uri_t uri_api_wifi_scan = {
    .uri = "/api/wifi-scan",
    .method = HTTP_GET,
    .handler = api_wifi_scan_handler,
};

static const httpd_uri_t uri_api_host_setup = {
    .uri = "/api/host-setup",
    .method = HTTP_POST,
    .handler = api_host_setup_handler,
};

static const httpd_uri_t uri_api_wifi_setup = {
    .uri = "/api/wifi-setup",
    .method = HTTP_POST,
    .handler = api_wifi_setup_handler,
};

static const httpd_uri_t uri_api_status = {
    .uri = "/api/status",
    .method = HTTP_GET,
    .handler = api_status_handler,
};

static const httpd_uri_t uri_api_commit = {
    .uri = "/api/commit",
    .method = HTTP_POST,
    .handler = api_commit_handler,
};

// GET /api/log - dump the captured ESP_LOG ring buffer as plain text.
// The C5's USB-Serial-JTAG pins are not broken out and UART0 belongs to the
// STM32 link, so this is the only way to read the log on assembled hardware.
static esp_err_t api_log_handler(httpd_req_t *req)
{
    size_t len = log_capture_size();
    char *buf = malloc(len + 1);
    if (!buf) {
        httpd_resp_set_status(req, "503 Service Unavailable");
        return httpd_resp_send(req, "out of memory", HTTPD_RESP_USE_STRLEN);
    }

    size_t n = log_capture_dump(buf, len + 1);
    httpd_resp_set_type(req, "text/plain");
    esp_err_t ret = httpd_resp_send(req, buf, n);
    free(buf);
    return ret;
}

static const httpd_uri_t uri_api_log = {
    .uri = "/api/log",
    .method = HTTP_GET,
    .handler = api_log_handler,
};

httpd_handle_t start_webserver(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.max_open_sockets = 13;
    // Registration silently returns HANDLERS_FULL if this is too low and no
    // caller below checks the return value, so keep headroom.
    config.max_uri_handlers = 16;
    config.lru_purge_enable = true;
    config.uri_match_fn = httpd_uri_match_wildcard;

    ESP_LOGI(TAG, "Starting HTTP server on port %d", config.server_port);

    if (httpd_start(&s_server, &config) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start HTTP server");
        return NULL;
    }

    // Register URI handlers
    httpd_register_uri_handler(s_server, &uri_index);
    httpd_register_uri_handler(s_server, &uri_favicon);
    httpd_register_uri_handler(s_server, &uri_api_wifi_scan);
    httpd_register_uri_handler(s_server, &uri_api_host_setup);
    httpd_register_uri_handler(s_server, &uri_api_wifi_setup);
    httpd_register_uri_handler(s_server, &uri_api_status);
    httpd_register_uri_handler(s_server, &uri_api_commit);

    // Development-provisioned devices only: the local SCPI socket (/ws), the
    // LCD mirror with virtual input (/screen, /screen-ws) and the log dump.
    // Production devices keep just the captive-portal/setup pages and /api/*,
    // so these paths answer 404 there (docs/serial-api.md).
    bool development = (s_prov_state.prov_mode == PROV_MODE_DEVELOPMENT);
    if (development) {
        httpd_register_uri_handler(s_server, &uri_ws);
        httpd_register_uri_handler(s_server, &uri_screen);
        httpd_register_uri_handler(s_server, &uri_screen_ws);
        httpd_register_uri_handler(s_server, &uri_api_log);
    }

    // 404 handler for captive portal
    httpd_register_err_handler(s_server, HTTPD_404_NOT_FOUND, http_404_error_handler);

    ESP_LOGI(TAG, "HTTP server started with API routes%s",
             development ? " and development WebSockets (/ws, /screen-ws)" : "");
    return s_server;
}
