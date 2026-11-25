#include "wifi.h"
#include "helpers.h"
#include "cloud.h"

static const char *TAG = "wifi";

static void cloud_start_task(void *arg)
{
    cloud_mode_start();
    vTaskDelete(NULL);
}

void wifi_event_handler(void *arg, esp_event_base_t event_base,
                        int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT) {
        switch (event_id) {
            case WIFI_EVENT_AP_STACONNECTED: {
                wifi_event_ap_staconnected_t *event = (wifi_event_ap_staconnected_t *)event_data;
                ESP_LOGI(TAG, "Station " MACSTR " joined AP, AID=%d",
                         MAC2STR(event->mac), event->aid);
                break;
            }
            case WIFI_EVENT_AP_STADISCONNECTED: {
                wifi_event_ap_stadisconnected_t *event = (wifi_event_ap_stadisconnected_t *)event_data;
                ESP_LOGI(TAG, "Station " MACSTR " left AP, AID=%d, reason=%d",
                         MAC2STR(event->mac), event->aid, event->reason);
                break;
            }
            case WIFI_EVENT_STA_START:
                ESP_LOGI(TAG, "STA started");
                // Don't auto-connect here - we connect explicitly via wifi_connect_sta()
                break;
            case WIFI_EVENT_STA_DISCONNECTED: {
                wifi_event_sta_disconnected_t *event = (wifi_event_sta_disconnected_t *)event_data;
                ESP_LOGW(TAG, "STA disconnected, reason=%d", event->reason);
                s_wifi_connected = false;
                s_sta_ip[0] = '\0';
                if (s_wifi_event_group) {
                    xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
                }
                // Auto-reconnect if we were previously configured
                if (s_setup_committed) {
                    ESP_LOGI(TAG, "Attempting to reconnect...");
                    esp_wifi_connect();
                }
                break;
            }
        }
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        snprintf(s_sta_ip, sizeof(s_sta_ip), IPSTR, IP2STR(&event->ip_info.ip));
        ESP_LOGI(TAG, "Got IP: %s", s_sta_ip);
        s_wifi_connected = true;
        if (s_wifi_event_group) {
            xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        }

        // Force SNTP re-sync on reconnection
        if (esp_sntp_enabled()) {
            esp_sntp_restart();
        }

        // Start cloud mode in a separate task (crypto needs more stack than sys_evt has)
        if (s_setup_committed && strcmp(s_setup_mode, "cloud") == 0) {
            xTaskCreate(cloud_start_task, "cloud_start", 8192, NULL, 5, NULL);
        }
    }
}

void wifi_init_ap(void)
{
    char ap_ssid[32];
    wifi_get_ap_ssid(ap_ssid, sizeof(ap_ssid));

    wifi_config_t wifi_config = {
        .ap = {
            .ssid_len = strlen(ap_ssid),
            .channel = AP_CHANNEL,
            .max_connection = AP_MAX_CONNECTIONS,
            .authmode = WIFI_AUTH_OPEN,
            .pmf_cfg = {
                .required = false,
            },
        },
    };
    memcpy(wifi_config.ap.ssid, ap_ssid, sizeof(wifi_config.ap.ssid));

    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));

    esp_netif_ip_info_t ip_info;
    esp_netif_get_ip_info(s_netif_ap, &ip_info);
    char ip_addr[16];
    inet_ntoa_r(ip_info.ip.addr, ip_addr, sizeof(ip_addr));

    ESP_LOGI(TAG, "AP initialized: SSID=%s, IP=%s", ap_ssid, ip_addr);
}

esp_err_t wifi_connect_sta(const char *ssid, const char *password)
{
    if (!s_netif_sta) {
        s_netif_sta = esp_netif_create_default_wifi_sta();
    }

    // Set DHCP hostname dynamically based on device name, or device serial if not configured
    const char *hostname = (strlen(s_device_name) > 0) ? s_device_name : s_device_serial;
    esp_netif_set_hostname(s_netif_sta, hostname);
    ESP_LOGI(TAG, "Set DHCP hostname to: %s", hostname);

    wifi_config_t wifi_config = {
        .sta = {
            .scan_method = WIFI_ALL_CHANNEL_SCAN,
            .failure_retry_cnt = 3,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK,
            .sae_pwe_h2e = WPA3_SAE_PWE_BOTH,
        },
    };

    safe_strcpy((char *)wifi_config.sta.ssid, ssid, sizeof(wifi_config.sta.ssid));
    safe_strcpy((char *)wifi_config.sta.password, password, sizeof(wifi_config.sta.password));

    // If password is empty, allow open networks
    if (strlen(password) == 0) {
        wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    }

    // Configure STA (don't change mode - caller sets appropriate mode)
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));

    // Disconnect if already connected (e.g., retrying wifi-setup during captive portal)
    esp_wifi_disconnect();

    // Clear previous state
    xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT | WIFI_FAIL_BIT);

    // Connect
    esp_err_t err = esp_wifi_connect();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_wifi_connect failed: %s", esp_err_to_name(err));
        return err;
    }

    // Wait for connection
    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                           WIFI_CONNECTED_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(WIFI_CONNECT_TIMEOUT_MS));

    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "Connected to %s", ssid);
        safe_strcpy(s_wifi_ssid, ssid, sizeof(s_wifi_ssid));
        return ESP_OK;
    } else {
        ESP_LOGW(TAG, "Failed to connect to %s", ssid);
        return ESP_FAIL;
    }
}

esp_err_t wifi_scan(wifi_ap_record_t *results, uint16_t *count)
{
    wifi_scan_config_t scan_config = {
        .ssid = NULL,
        .bssid = NULL,
        .channel = 0,
        .show_hidden = false,
        .scan_type = WIFI_SCAN_TYPE_ACTIVE,
        .scan_time = {
            .active = {
                .min = 100,
                .max = 300,
            },
        },
    };

    esp_err_t err = esp_wifi_scan_start(&scan_config, true);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi scan start failed: %s", esp_err_to_name(err));
        return err;
    }

    err = esp_wifi_scan_get_ap_records(count, results);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "WiFi scan get records failed: %s", esp_err_to_name(err));
    }

    return err;
}

void start_mdns_service(void)
{
    if (strlen(s_device_name) == 0) {
        ESP_LOGW(TAG, "Device name not set, skipping mDNS");
        return;
    }

    // Convert device name to lowercase for hostname
    char hostname[64];
    safe_strcpy(hostname, s_device_name, sizeof(hostname));
    for (char *p = hostname; *p; p++) {
        if (*p >= 'A' && *p <= 'Z') *p += 32;
    }

    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS init failed: %s", esp_err_to_name(err));
        return;
    }

    err = mdns_hostname_set(hostname);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS hostname set failed: %s", esp_err_to_name(err));
        return;
    }

    err = mdns_instance_name_set("molstem thermocycler");
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "mDNS instance name set failed: %s", esp_err_to_name(err));
    }

    // Add HTTP service
    err = mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0);
    if (err != ESP_OK) {
        ESP_LOGW(TAG, "mDNS service add failed: %s", esp_err_to_name(err));
    }

    ESP_LOGI(TAG, "mDNS started: %s.local", hostname);
}

bool is_configuration_mode(void)
{
    return !s_setup_committed || !s_wifi_connected;
}

bool is_local_mode(void)
{
    return s_setup_committed && s_wifi_connected && strcmp(s_setup_mode, "local") == 0;
}

void wifi_get_ap_ssid(char *ssid, size_t len)
{
    // Use first 8 characters of device serial, skipping "MOLSTEM-" prefix if present
    const char *serial = s_device_serial;
    if (strncmp(serial, "MOLSTEM-", 8) == 0) {
        serial += 8;
    }
    char suffix[9] = {0};
    size_t serial_len = strlen(serial);
    size_t copy_len = serial_len < 8 ? serial_len : 8;
    memcpy(suffix, serial, copy_len);

    snprintf(ssid, len, "%s%s", AP_SSID_PREFIX, suffix);
}

void wifi_reset_to_config_mode(void)
{
    ESP_LOGI(TAG, "Resetting to configuration mode");

    // Erase only wifi/setup NVS keys (preserve buzzer, wifi_en, and provisioning data)
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_key(handle, NVS_KEY_MODE);
        nvs_erase_key(handle, NVS_KEY_DEVICE_NAME);
        nvs_erase_key(handle, NVS_KEY_PASSWORD);
        nvs_erase_key(handle, NVS_KEY_WIFI_SSID);
        nvs_erase_key(handle, NVS_KEY_WIFI_PASS);
        nvs_erase_key(handle, NVS_KEY_REGION);
        nvs_erase_key(handle, NVS_KEY_TIMEZONE);
        nvs_erase_key(handle, NVS_KEY_CONFIGURED);
        nvs_commit(handle);
        nvs_close(handle);
    }

    // Reset in-memory state (preserve settings)
    s_setup_committed = false;
    s_wifi_connected = false;
    s_setup_mode[0] = '\0';
    s_wifi_ssid[0] = '\0';
    s_wifi_password[0] = '\0';
    s_device_name[0] = '\0';
    s_device_password[0] = '\0';

    // Disconnect STA and switch to APSTA mode
    esp_wifi_disconnect();
    esp_wifi_set_mode(WIFI_MODE_APSTA);
    wifi_init_ap();

    // Start DNS server for captive portal
    if (!s_dns_server) {
        dns_server_config_t dns_config = DNS_SERVER_CONFIG_SINGLE("*", "WIFI_AP_DEF");
        s_dns_server = start_dns_server(&dns_config);
    }

    ESP_LOGI(TAG, "Device reset to configuration mode (captive portal)");
}

void wifi_set_enabled(bool enabled)
{
    if (enabled) {
        ESP_LOGI(TAG, "WiFi enabled");

        if (s_setup_committed) {
            // Configured device: connect as STA
            esp_wifi_set_mode(WIFI_MODE_STA);
            esp_wifi_start();
            wifi_connect_sta(s_wifi_ssid, s_wifi_password);
        } else {
            // Unconfigured: start captive portal
            esp_wifi_set_mode(WIFI_MODE_APSTA);
            wifi_init_ap();
            esp_wifi_start();

            if (!s_dns_server) {
                dns_server_config_t dns_config = DNS_SERVER_CONFIG_SINGLE("*", "WIFI_AP_DEF");
                s_dns_server = start_dns_server(&dns_config);
            }
        }
    } else {
        ESP_LOGI(TAG, "WiFi disabled");

        // Stop DNS server if running
        if (s_dns_server) {
            stop_dns_server(s_dns_server);
            s_dns_server = NULL;
        }

        // Destroy cloud WebSocket if connected
        if (s_cloud_ws) {
            esp_websocket_client_close(s_cloud_ws, portMAX_DELAY);
            esp_websocket_client_destroy(s_cloud_ws);
            s_cloud_ws = NULL;
        }
        s_cloud_ws_reconnecting = false;

        esp_wifi_disconnect();
        esp_wifi_stop();
        s_wifi_connected = false;
    }
}
