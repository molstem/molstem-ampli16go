#include "cloud.h"
#include "helpers.h"
#include "host_queue.h"
#include "scpi_line.h"

static const char *TAG = "cloud";
// ============ Cloud Mode Functions ============

// Initialize SNTP for getting real time (required for valid signatures)
static bool s_sntp_initialized = false;

static void sntp_time_sync_notification(struct timeval *tv)
{
    ESP_LOGI(TAG, "SNTP time synchronized: %lld", (long long)tv->tv_sec);
}

esp_err_t sntp_init_time(void)
{
    // Don't re-initialize if already running
    if (s_sntp_initialized) {
        // Just check if time is synced
        if (esp_sntp_get_sync_status() == SNTP_SYNC_STATUS_COMPLETED) {
            ESP_LOGI(TAG, "SNTP already synced");
            return ESP_OK;
        }
        // Wait for existing sync to complete
        int retry = 0;
        const int retry_count = 30;
        while (esp_sntp_get_sync_status() == SNTP_SYNC_STATUS_RESET && ++retry < retry_count) {
            ESP_LOGI(TAG, "Waiting for SNTP sync... (%d/%d)", retry, retry_count);
            vTaskDelay(pdMS_TO_TICKS(500));
        }
        return (retry < retry_count) ? ESP_OK : ESP_FAIL;
    }

    ESP_LOGI(TAG, "Initializing SNTP...");

    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    esp_sntp_set_time_sync_notification_cb(sntp_time_sync_notification);
    esp_sntp_init();
    s_sntp_initialized = true;

    // Wait for time to be set (max 15 seconds)
    int retry = 0;
    const int retry_count = 30;
    while (esp_sntp_get_sync_status() == SNTP_SYNC_STATUS_RESET && ++retry < retry_count) {
        ESP_LOGI(TAG, "Waiting for SNTP sync... (%d/%d)", retry, retry_count);
        vTaskDelay(pdMS_TO_TICKS(500));
    }

    if (retry >= retry_count) {
        ESP_LOGE(TAG, "SNTP sync failed after %d retries", retry_count);
        return ESP_FAIL;
    }

    time_t now;
    time(&now);
    ESP_LOGI(TAG, "SNTP time set: %lu", (unsigned long)now);
    return ESP_OK;
}

// Initialize cryptographic context for device signing
// Uses the provisioned key loaded from NVS at boot by init_provisioning_state()
esp_err_t cloud_crypto_init(void)
{
    if (s_cloud_crypto_initialized) {
        return ESP_OK;
    }

    if (!s_prov_crypto_initialized || !device_key_is_loaded()) {
        ESP_LOGE(TAG, "Provisioning crypto not initialized (no key in NVS)");
        return ESP_FAIL;
    }

    // PSA is already initialized by the provisioning path and draws randomness
    // from the ESP32 hardware RNG, so there is no DRBG to seed here.
    s_cloud_crypto_initialized = true;
    ESP_LOGI(TAG, "Cloud crypto initialized, using provisioned signing key");
    return ESP_OK;
}

// Create X-Device-Auth header with ECDSA signature
static esp_err_t create_device_auth_header(char *header_buf, size_t buf_size)
{
    if (!s_cloud_crypto_initialized) {
        return ESP_FAIL;
    }

    // Allocate working buffer on heap (avoids stack overflow in httpd task)
    char *work_buf = malloc(512);
    if (!work_buf) {
        ESP_LOGE(TAG, "Failed to allocate work buffer");
        return ESP_FAIL;
    }

    esp_err_t result = ESP_OK;

    // Get current timestamp
    time_t now;
    time(&now);
    uint32_t timestamp = (uint32_t)now;

    // Generate 16-byte random nonce (32 hex chars)
    uint8_t nonce_bytes[16];
    esp_fill_random(nonce_bytes, sizeof(nonce_bytes));
    char nonce_hex[33];
    for (int i = 0; i < 16; i++) {
        snprintf(&nonce_hex[i * 2], 3, "%02x", nonce_bytes[i]);
    }
    nonce_hex[32] = '\0';

    // Create message to sign: "{serial}:{timestamp}:{nonce}"
    snprintf(work_buf, 128, "%s:%lu:%s", s_device_serial, (unsigned long)timestamp, nonce_hex);
    ESP_LOGI(TAG, "Message to sign: %s (len=%d)", work_buf, strlen(work_buf));

    // Hash the message with SHA-256
    uint8_t hash[32];
    if (crypto_sha256(work_buf, strlen(work_buf), hash) != ESP_OK) {
        ESP_LOGE(TAG, "Hashing failed");
        result = ESP_FAIL;
        goto cleanup;
    }

    // Log hash for debugging
    ESP_LOGI(TAG, "SHA256 hash: %02x%02x%02x%02x...", hash[0], hash[1], hash[2], hash[3]);

    // Sign with ECDSA - PSA returns P1363 (r || s, 64 bytes) directly
    uint8_t sig_p1363[DEVICE_KEY_SIG_LEN];
    if (device_key_sign_hash(hash, sig_p1363) != ESP_OK) {
        ESP_LOGE(TAG, "Signing failed");
        result = ESP_FAIL;
        goto cleanup;
    }

    ESP_LOGI(TAG, "P1363 sig: %02x%02x%02x%02x...%02x%02x%02x%02x",
             sig_p1363[0], sig_p1363[1], sig_p1363[2], sig_p1363[3],
             sig_p1363[60], sig_p1363[61], sig_p1363[62], sig_p1363[63]);

    // Base64 encode signature into a separate stack buffer (small enough to be safe)
    char sig_b64[100];
    size_t sig_b64_len;
    mbedtls_base64_encode((unsigned char *)sig_b64, sizeof(sig_b64), &sig_b64_len,
                          sig_p1363, sizeof(sig_p1363));
    sig_b64[sig_b64_len] = '\0';

    ESP_LOGI(TAG, "Sig b64: %s", sig_b64);

    // Build JSON payload in work_buf
    snprintf(work_buf, 384,
             "{\"serial\":\"%s\",\"timestamp\":%lu,\"nonce\":\"%s\",\"signature\":\"%s\"}",
             s_device_serial, (unsigned long)timestamp, nonce_hex, sig_b64);

    ESP_LOGI(TAG, "JSON payload: %s", work_buf);

    // Base64 encode the JSON payload for the header
    size_t header_len;
    int ret = mbedtls_base64_encode((unsigned char *)header_buf, buf_size, &header_len,
                                    (const unsigned char *)work_buf, strlen(work_buf));
    if (ret != 0) {
        ESP_LOGE(TAG, "Base64 encode failed: -0x%04x", -ret);
        result = ESP_FAIL;
        goto cleanup;
    }
    header_buf[header_len] = '\0';

cleanup:
    free(work_buf);
    return result;
}

// Extract base64 content from PEM (skip headers)
static void extract_pubkey_base64(const char *pem, char *b64_out, size_t out_size)
{
    // Find start after "-----BEGIN PUBLIC KEY-----\n"
    const char *start = strstr(pem, "-----BEGIN");
    if (start) {
        start = strchr(start, '\n');
        if (start) start++;
    }
    if (!start) start = pem;

    // Copy until "-----END" or end of string, skipping newlines
    size_t j = 0;
    for (const char *p = start; *p && j < out_size - 1; p++) {
        if (*p == '-') break;  // Hit "-----END"
        if (*p != '\n' && *p != '\r') {
            b64_out[j++] = *p;
        }
    }
    b64_out[j] = '\0';
}

// HTTP event handler for cloud registration
static char s_http_response_buf[512];
static int s_http_response_len = 0;

static esp_err_t cloud_http_event_handler(esp_http_client_event_t *evt)
{
    switch (evt->event_id) {
        case HTTP_EVENT_ON_DATA:
            if (s_http_response_len + evt->data_len < sizeof(s_http_response_buf) - 1) {
                memcpy(s_http_response_buf + s_http_response_len, evt->data, evt->data_len);
                s_http_response_len += evt->data_len;
                s_http_response_buf[s_http_response_len] = '\0';
            }
            break;
        default:
            break;
    }
    return ESP_OK;
}

// Register device with cloud and get enrollment ID
esp_err_t cloud_register(void)
{
    // Use separate allocations to avoid compiler overlap warnings
    char *body = malloc(512);
    char *auth_header = malloc(512);
    char *url = malloc(128);
    char *pubkey_b64 = malloc(256);

    if (!body || !auth_header || !url || !pubkey_b64) {
        ESP_LOGE(TAG, "Failed to allocate cloud_register buffers");
        free(body); free(auth_header); free(url); free(pubkey_b64);
        return ESP_FAIL;
    }

    snprintf(url, 128, "https://%s%s", CLOUD_HOST, CLOUD_REGISTER_PATH);

    // Get public key as base64 (from provisioned key in NVS)
    char pubkey_pem[256];
    if (device_key_export_pem(pubkey_pem, sizeof(pubkey_pem)) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to export public key PEM");
        free(body); free(auth_header); free(url); free(pubkey_b64);
        return ESP_FAIL;
    }
    extract_pubkey_base64(pubkey_pem, pubkey_b64, 256);
    ESP_LOGI(TAG, "Public key b64: %s", pubkey_b64);

    // Build JSON body with serial and public key
    snprintf(body, 512,
             "{\"serial_number\":\"%s\",\"public_key\":\"%s\"}",
             s_device_serial, pubkey_b64);
    ESP_LOGI(TAG, "Registration body: %s", body);

    // Create device auth header
    esp_err_t err = create_device_auth_header(auth_header, 512);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to create auth header");
        free(body); free(auth_header); free(url); free(pubkey_b64);
        return err;
    }

    // Clear response buffer
    s_http_response_len = 0;
    s_http_response_buf[0] = '\0';

    esp_http_client_config_t config = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .client_cert_pem = s_mtls_cert,
        .client_key_pem = s_mtls_key,
        .timeout_ms = 15000,
        .event_handler = cloud_http_event_handler,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) {
        ESP_LOGE(TAG, "Failed to init HTTP client");
        free(body); free(auth_header); free(url); free(pubkey_b64);
        return ESP_FAIL;
    }

    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_header(client, "X-Device-Auth", auth_header);
    esp_http_client_set_post_field(client, body, strlen(body));

    ESP_LOGI(TAG, "Registering with cloud: %s", url);
    err = esp_http_client_perform(client);

    if (err == ESP_OK) {
        int status = esp_http_client_get_status_code(client);
        ESP_LOGI(TAG, "Registration response: status=%d, body=%s", status, s_http_response_buf);

        if (status == 200 || status == 201) {
            if (strstr(s_http_response_buf, "\"enrolled\":true") != NULL) {
                // Already claimed by a user: no code to show, nothing more to do
                s_cloud_enrolled = true;
                s_cloud_enrollment_id[0] = '\0';
                ESP_LOGI(TAG, "Registration successful, device is enrolled");
            } else if (json_get_string(s_http_response_buf, "enrollment_id",
                                       s_cloud_enrollment_id, sizeof(s_cloud_enrollment_id))) {
                s_cloud_enrolled = false;
                ESP_LOGI(TAG, "Registration successful, enrollment_id: %s", s_cloud_enrollment_id);
            } else {
                ESP_LOGE(TAG, "Failed to parse enrollment_id from response");
                err = ESP_FAIL;
            }
        } else {
            ESP_LOGE(TAG, "Registration failed with status %d", status);
            err = ESP_FAIL;
        }
    } else {
        ESP_LOGE(TAG, "HTTP request failed: %s", esp_err_to_name(err));
    }

    esp_http_client_cleanup(client);
    free(body); free(auth_header); free(url); free(pubkey_b64);
    return err;
}

// Forward declarations
static void cloud_ws_event_handler(void *handler_args, esp_event_base_t base,
                                   int32_t event_id, void *event_data);
static void cloud_ws_reconnect_task(void *arg);

// The cloud unenrolled this device: fetch a fresh enrollment code so the LCD /
// captive portal show it without a reboot. Runs in its own task because
// cloud_register() blocks on HTTP and must not run in the WebSocket event loop.
static void cloud_reregister_task(void *arg)
{
    (void)arg;
    s_cloud_enrolled = false;
    s_cloud_enrollment_id[0] = '\0';
    if (cloud_register() == ESP_OK) {
        ESP_LOGI(TAG, "Re-registered after unenroll: %s",
                 s_cloud_enrolled ? "still enrolled" : s_cloud_enrollment_id);
    } else {
        ESP_LOGW(TAG, "Re-registration after unenroll failed; will retry at next boot");
    }
    vTaskDelete(NULL);
}

// Connect to cloud WebSocket
esp_err_t cloud_ws_connect(void)
{
    // Use separate allocations to avoid compiler overlap warnings
    char *headers = malloc(600);
    char *auth_header = malloc(512);
    char *url = malloc(256);

    if (!headers || !auth_header || !url) {
        ESP_LOGE(TAG, "Failed to allocate cloud_ws_connect buffers");
        free(headers); free(auth_header); free(url);
        return ESP_FAIL;
    }

    // Create fresh auth header for this connection
    esp_err_t err = create_device_auth_header(auth_header, 512);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to create auth header for WebSocket");
        free(headers); free(auth_header); free(url);
        return err;
    }

    snprintf(url, 256, "wss://%s%s?serial=%s",
             CLOUD_HOST, CLOUD_WS_PATH, s_device_serial);

    // Build headers string with X-Device-Auth
    snprintf(headers, 600, "X-Device-Auth: %s\r\n", auth_header);

    esp_websocket_client_config_t config = {
        .uri = url,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .client_cert = s_mtls_cert,
        .client_key = s_mtls_key,
        .reconnect_timeout_ms = 5000,
        .network_timeout_ms = 10000,
        .headers = headers,
    };

    s_cloud_ws = esp_websocket_client_init(&config);
    if (!s_cloud_ws) {
        ESP_LOGE(TAG, "Failed to init WebSocket client");
        free(headers); free(auth_header); free(url);
        return ESP_FAIL;
    }

    esp_websocket_register_events(s_cloud_ws, WEBSOCKET_EVENT_ANY,
                                  cloud_ws_event_handler, NULL);

    ESP_LOGI(TAG, "Connecting to cloud WebSocket: %s", url);
    err = esp_websocket_client_start(s_cloud_ws);

    // Note: We can free buffers here because esp_websocket_client_init copies the strings
    free(headers); free(auth_header); free(url);
    return err;
}

// WebSocket event handler
static void cloud_ws_event_handler(void *handler_args, esp_event_base_t base,
                                   int32_t event_id, void *event_data)
{
    esp_websocket_event_data_t *data = (esp_websocket_event_data_t *)event_data;

    switch (event_id) {
        case WEBSOCKET_EVENT_CONNECTED:
            ESP_LOGI(TAG, "Cloud WebSocket connected");
            break;

        case WEBSOCKET_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "Cloud WebSocket disconnected");
            if (!s_cloud_ws_reconnecting &&
                s_setup_committed && strcmp(s_setup_mode, "cloud") == 0) {
                s_cloud_ws_reconnecting = true;
                xTaskCreate(cloud_ws_reconnect_task, "ws_reconn", 4096, NULL, 5, NULL);
            }
            break;

        case WEBSOCKET_EVENT_DATA:
            // The cloud DeviceProxy relays the user's SCPI request lines as
            // text OR binary frames (the web app's cloud provider sends bytes,
            // the Devices page terminal sends text) and may send JSON control
            // messages. Queue lines for the STM32 with the cloud tag; replies
            // return through host_reply() as text frames.
            if (data->op_code == 0x01 || data->op_code == 0x02) {  // Text or binary
                ESP_LOGI(TAG, "Cloud WS recv: %.*s", data->data_len, (char *)data->data_ptr);
                char ctrl[64] = {0};
                if (data->payload_offset == 0 && data->data_len > 0 && data->data_len < sizeof(ctrl) &&
                    data->data_ptr[0] == '{') {
                    memcpy(ctrl, data->data_ptr, data->data_len);   // small JSON control message
                }
                if (strstr(ctrl, "\"reregister\"") != NULL) {
                    // Control message from the cloud (not an SCPI line)
                    xTaskCreate(cloud_reregister_task, "cloud_rereg", 8192, NULL, 5, NULL);
                } else if (data->payload_offset == 0 && data->payload_len <= data->data_len) {
                    host_queue_feed(HOST_TAG_CLOUD, (const uint8_t *)data->data_ptr, data->data_len);
                } else if (data->payload_offset == 0) {
                    // First chunk of a message larger than the client's receive
                    // buffer: far beyond any valid request line, so answer once
                    // and drop the remaining chunks.
                    char err[48];
                    int n = scpi_format_err(err, sizeof(err), SCPI_ERR_LINE_TOO_LONG, NULL);
                    ESP_LOGW(TAG, "Cloud WS message too large (%d bytes), dropped", data->payload_len);
                    host_reply(HOST_TAG_CLOUD, err, (size_t)n);
                }
            }
            break;

        case WEBSOCKET_EVENT_ERROR:
            ESP_LOGE(TAG, "Cloud WebSocket error");
            break;

        default:
            break;
    }
}

// Task to handle WebSocket reconnection with fresh auth headers
static void cloud_ws_reconnect_task(void *arg)
{
    ESP_LOGI(TAG, "WebSocket reconnect task started, waiting 5s...");

    // Wait a bit before reconnecting
    vTaskDelay(pdMS_TO_TICKS(5000));

    int retry_count = 0;
    const int max_retries = 10;

    while (retry_count < max_retries) {
        // Abort if no longer in cloud mode
        if (!s_setup_committed || strcmp(s_setup_mode, "cloud") != 0) {
            ESP_LOGI(TAG, "No longer in cloud mode, aborting reconnect");
            s_cloud_ws_reconnecting = false;
            vTaskDelete(NULL);
            return;
        }

        // Destroy old client if it exists
        if (s_cloud_ws) {
            ESP_LOGI(TAG, "Destroying old WebSocket client...");
            esp_websocket_client_destroy(s_cloud_ws);
            s_cloud_ws = NULL;
        }

        // Reconnect with fresh auth headers
        ESP_LOGI(TAG, "Reconnecting WebSocket with fresh auth (attempt %d/%d)...",
                 retry_count + 1, max_retries);
        esp_err_t err = cloud_ws_connect();
        if (err == ESP_OK) {
            ESP_LOGI(TAG, "WebSocket reconnect initiated successfully");
            s_cloud_ws_reconnecting = false;
            vTaskDelete(NULL);
            return;
        }

        retry_count++;
        ESP_LOGE(TAG, "WebSocket reconnect failed, will retry in 30s");
        vTaskDelay(pdMS_TO_TICKS(30000));
    }

    // Max retries reached, allow new reconnect task to be created on next disconnect
    ESP_LOGE(TAG, "WebSocket reconnect gave up after %d attempts", max_retries);
    s_cloud_ws_reconnecting = false;
    vTaskDelete(NULL);
}

// Start cloud mode (called after WiFi connects)
void cloud_mode_start(void)
{
    // Guard against duplicate invocations (e.g., reconnect while already connected)
    if (s_cloud_ws != NULL) {
        ESP_LOGI(TAG, "Cloud mode already active, skipping");
        return;
    }

    ESP_LOGI(TAG, "Starting cloud mode...");

    if (!s_mtls_cert || !s_mtls_key) {
        ESP_LOGE(TAG, "Cannot start cloud mode: mTLS credentials not provisioned");
        return;
    }

    // Sync time via SNTP (required for valid signatures)
    esp_err_t err = sntp_init_time();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to sync time via NTP");
        return;
    }

    // Initialize crypto
    err = cloud_crypto_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize cloud crypto");
        return;
    }

    // Register with cloud to get enrollment ID
    ESP_LOGI(TAG, "Registering with cloud...");
    err = cloud_register();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Cloud registration failed");
        // Continue anyway - WebSocket might still work if already registered
    }

    // Connect WebSocket
    err = cloud_ws_connect();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start cloud WebSocket");
        return;
    }

    ESP_LOGI(TAG, "Cloud mode started");
}
