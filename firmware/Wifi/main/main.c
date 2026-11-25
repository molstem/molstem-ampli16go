/* molstem thermocycler captive portal with API backend
 *
 * Implements a WiFi captive portal with REST API endpoints for device setup.
 * Supports AP mode for initial setup and AP+STA mode after WiFi configuration.
 * Cloud mode: connects to devices.molstem.com via mTLS + device signing.
 */

#include "config.h"
#include "helpers.h"
#include "nvs_config.h"
#include "wifi.h"
#include "http_handlers.h"
#include "ws_bridge.h"
#include "provisioning.h"
#include "cloud.h"
#include "log_capture.h"

static const char *TAG = "easycpr_main";

// ============ Main ============

TaskHandle_t stm_io_uart_task_handle = NULL;;
void app_main(void)
{
    // Install the log ring buffer first so startup logging is captured too;
    // read it back with GET /api/log (development provisioning only).
    log_capture_init();

    xTaskCreate(stm_io_uart_task, "stm_io_uart", 4096, NULL, 20, &stm_io_uart_task_handle);

    // Reduce HTTP server log noise
    esp_log_level_set("httpd_uri", ESP_LOG_ERROR);
    esp_log_level_set("httpd_txrx", ESP_LOG_ERROR);
    esp_log_level_set("httpd_parse", ESP_LOG_ERROR);

    // The WiFi driver emits a few KB of (vht)/(he)/(opr)/(spr) capability dumps
    // per association, which otherwise evicts everything else from the /api/log
    // ring buffer before it can be read.
    esp_log_level_set("wifi", ESP_LOG_ERROR);

    ESP_LOGI(TAG, "molstem thermocycler captive portal starting...");

    // Initialize NVS (default partition)
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    // Initialize NVS factory partition (for provisioning data)
    ret = nvs_flash_init_partition("nvs_factory");
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase_partition("nvs_factory"));
        ret = nvs_flash_init_partition("nvs_factory");
    }
    ESP_ERROR_CHECK(ret);

    // Load provisioning state (keypair, serial, mode) if device was provisioned
    // This may override s_device_serial with the cryptographically-derived serial
    init_provisioning_state();

    // Load saved configuration
    nvs_load_config();

    // Initialize networking
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    // Create event group for WiFi
    s_wifi_event_group = xEventGroupCreate();

    // Create network interfaces (both AP and STA for APSTA mode)
    s_netif_ap = esp_netif_create_default_wifi_ap();
    s_netif_sta = esp_netif_create_default_wifi_sta();

    // Initialize WiFi
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    // Register event handlers
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                                        &wifi_event_handler, NULL, NULL));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                                        &wifi_event_handler, NULL, NULL));

    // If device is not provisioned, wait for provisioning via USB serial only
    if (!s_prov_state.prov_committed) {
        ESP_LOGI(TAG, "Device not provisioned - waiting for USB serial provisioning");
        ESP_LOGI(TAG, "No WiFi or other services will start until provisioning is complete");

        for(;;) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }

    // Device is provisioned - start HTTP server and WiFi
    start_webserver();

    if (!s_setting_wifi) {
        ESP_LOGI(TAG, "WiFi disabled by user setting, skipping WiFi startup");
    } else if (s_setup_committed) {
        ESP_LOGI(TAG, "Device configured, connecting to %s", s_wifi_ssid);

        // Start in STA-only mode (no AP needed)
        ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
        ESP_ERROR_CHECK(esp_wifi_start());

        for(;;) {
            esp_err_t err = wifi_connect_sta(s_wifi_ssid, s_wifi_password);
            if (err == ESP_OK) {
                ESP_LOGI(TAG, "Connected to WiFi successfully");

                // Start mode-specific services
                // Note: cloud_mode_start() is triggered by the IP_EVENT handler in wifi.c
                if (strcmp(s_setup_mode, "local") == 0) {
                    start_mdns_service();
                }

                // Don't start DNS server - we're in normal operation mode
                ESP_LOGI(TAG, "Device ready in %s mode", s_setup_mode);
                break;
            } else {
                ESP_LOGW(TAG, "Failed to connect, retrying in 5s...");
                vTaskDelay(pdMS_TO_TICKS(5000));
            }
        }
    } else {
        // Provisioned but WiFi not configured - start captive portal
        ESP_LOGI(TAG, "WiFi not configured - starting captive portal");

        // Start in APSTA mode (enables scanning while serving captive portal)
        ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_APSTA));
        wifi_init_ap();
        ESP_ERROR_CHECK(esp_wifi_start());

        // Start DNS server for captive portal
        dns_server_config_t dns_config = DNS_SERVER_CONFIG_SINGLE("*", "WIFI_AP_DEF");
        s_dns_server = start_dns_server(&dns_config);

        ESP_LOGI(TAG, "Captive portal ready!");
        ESP_LOGI(TAG, "Connect to WiFi network: molstem-XXXXXXXX");
    }
}
