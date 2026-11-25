#pragma once

#include <string.h>
#include <stdlib.h>
#include <sys/param.h>
#include <time.h>
#include <stdbool.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"

#include "esp_event.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_chip_info.h"
#include "esp_system.h"
#include "esp_random.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "lwip/inet.h"

#include "esp_http_server.h"
#include "dns_server.h"
#include "mdns.h"
#include "driver/uart.h"

// Cloud mode includes
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_websocket_client.h"
#include "esp_sntp.h"
// Mbed TLS 4.x (ESP-IDF v6.0) keeps base64 but moved the crypto primitives to
// PSA Crypto - see device_key.h for the device identity key and its operations.
#include "mbedtls/base64.h"
#include "device_key.h"

#include "stm_serial.h"

// ============ Configuration ============

// Cloud configuration
#define CLOUD_HOST "devices.molstem.com"
#define CLOUD_REGISTER_PATH "/v0/register"
#define CLOUD_WS_PATH "/v0/ws"

#define AP_SSID_PREFIX "molstem-"
#define AP_PASSWORD "" // Open network for captive portal
#define AP_MAX_CONNECTIONS 4
#define AP_CHANNEL 1

#define NVS_NAMESPACE "molstem"
#define NVS_KEY_DEVICE_ID "device_id"
#define NVS_KEY_MODE "mode"
#define NVS_KEY_DEVICE_NAME "dev_name"
#define NVS_KEY_PASSWORD "password"
#define NVS_KEY_WIFI_SSID "wifi_ssid"
#define NVS_KEY_WIFI_PASS "wifi_pass"
#define NVS_KEY_REGION "region"
#define NVS_KEY_TIMEZONE "timezone"
#define NVS_KEY_CONFIGURED "configured"
#define NVS_KEY_BUZZER "buzzer"
#define NVS_KEY_WIFI_EN "wifi_en"

// Provisioning NVS keys (stored in nvs_factory partition)
#define NVS_KEY_PRIVATE_KEY "priv_key"
#define NVS_KEY_PUBLIC_KEY "pub_key"
#define NVS_KEY_MTLS_CERT "mtls_cert"
#define NVS_KEY_MTLS_KEY "mtls_key"
#define NVS_KEY_PA_PUBKEY "pa_pubkey"
#define NVS_KEY_CAL_KP "cal_kp"
#define NVS_KEY_CAL_TI "cal_ti"
#define NVS_KEY_CAL_TD "cal_td"
#define NVS_KEY_CAL_TF "cal_tf"
#define NVS_KEY_CAL_KB "cal_kb"
#define NVS_KEY_HW_VERSION "hw_ver"
#define NVS_KEY_HW_COMMENT "hw_comment"
#define NVS_KEY_PROV_MODE "prov_mode"
#define NVS_KEY_PROV_COMMITTED "prov_done"

// Provisioning mode enum values (stored as u8)
typedef enum {
    PROV_MODE_UNPROVISIONED = 0,
    PROV_MODE_DEVELOPMENT = 1,
    PROV_MODE_PRODUCTION = 2
} prov_mode_t;

// Provisioning request/response lines are bounded by SCPI_LINE_MAX / SCPI_OUT_MAX
// (4096, set in main/CMakeLists.txt for the shared scpi_line parser).

#define MAX_WIFI_SCAN_RESULTS 20
#define WIFI_CONNECT_TIMEOUT_MS 30000
#define JSON_BUFFER_SIZE 2048

// UART configuration for serial bridge
#define UART_NUM UART_NUM_0
#define UART_BAUD_RATE 115200
#define UART_BUF_SIZE 1024

// WiFi connection event bits
#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT BIT1

// Provisioning state (in-memory cache of nvs_factory values)
typedef struct {
    bool identity_generated;
    bool prov_committed;          // True after SET_SIGNOFF succeeds
    prov_mode_t prov_mode;
    float cal_kp;
    float cal_ti;
    float cal_td;
    float cal_tf;
    float cal_kb;
    char hw_version[32];
    char hw_comment[128];
    // Hardware test results (2 mock tests)
    uint8_t test_led_status;      // 0=pending, 1=passed, 2=failed
    uint8_t test_temp_status;     // 0=pending, 1=passed, 2=failed
    // Checklist items (2 mock items)
    bool checklist_label;         // Serial number label applied
    bool checklist_sealed;        // Device enclosure sealed
} prov_state_t;

// ============ Shared Global Variables ============

extern httpd_handle_t s_server;
extern esp_netif_t *s_netif_ap;
extern esp_netif_t *s_netif_sta;
extern EventGroupHandle_t s_wifi_event_group;
extern dns_server_handle_t s_dns_server;

// WebSocket state for serial bridge
extern int s_ws_fd;
extern int s_screen_ws_fd;

// Device state
extern char s_device_serial[34];
extern char s_device_name[64];
extern char s_device_password[64];
extern char s_setup_mode[8];
extern char s_wifi_ssid[33];
extern char s_wifi_password[64];
extern char s_sta_ip[16];
extern bool s_wifi_connected;
extern bool s_setup_committed;

// Device settings (persisted in NVS)
extern bool s_setting_buzzer;
extern bool s_setting_wifi;

// Cloud mode state
extern esp_websocket_client_handle_t s_cloud_ws;
extern bool s_cloud_crypto_initialized;
extern char s_cloud_enrollment_id[24];
extern volatile bool s_cloud_enrolled;   // cloud says this device already belongs to a user
extern bool s_cloud_ws_reconnecting;

// Provisioning crypto state (the key itself lives in device_key.c)
extern bool s_prov_crypto_initialized;

extern prov_state_t s_prov_state;

// mTLS credentials (loaded from NVS at boot)
extern char *s_mtls_cert;  // heap-allocated PEM cert, NULL if not provisioned
extern char *s_mtls_key;   // heap-allocated PEM key, NULL if not provisioned

// ============ Embedded Resources ============

extern const char index_start[] asm("_binary_index_html_gz_start");
extern const char index_end[] asm("_binary_index_html_gz_end");
extern const char index_app_start[] asm("_binary_index_app_html_gz_start");
extern const char index_app_end[] asm("_binary_index_app_html_gz_end");
extern const char favicon_start[] asm("_binary_favicon_png_start");
extern const char favicon_end[] asm("_binary_favicon_png_end");
extern const char screen_html_start[] asm("_binary_screen_html_start");
extern const char screen_html_end[] asm("_binary_screen_html_end");

