#include "config.h"

const char *TAG = "molstem";

httpd_handle_t s_server = NULL;
esp_netif_t *s_netif_ap = NULL;
esp_netif_t *s_netif_sta = NULL;
EventGroupHandle_t s_wifi_event_group = NULL;
dns_server_handle_t s_dns_server = NULL;

// WebSocket state for serial bridge
int s_ws_fd = -1;
int s_screen_ws_fd = -1;

// Device state
char s_device_serial[34] = {0};
char s_device_name[64] = {0};
char s_device_password[64] = {0};
char s_setup_mode[8] = "local";
char s_wifi_ssid[33] = {0};
char s_wifi_password[64] = {0};
char s_sta_ip[16] = {0};
bool s_wifi_connected = false;
bool s_setup_committed = false;

// Device settings
bool s_setting_buzzer = true;
bool s_setting_wifi = true;

// Cloud mode state
esp_websocket_client_handle_t s_cloud_ws = NULL;
bool s_cloud_crypto_initialized = false;
char s_cloud_enrollment_id[24] = {0};
volatile bool s_cloud_enrolled = false;
bool s_cloud_ws_reconnecting = false;

// Provisioning crypto state (the key itself lives in device_key.c)
bool s_prov_crypto_initialized = false;

prov_state_t s_prov_state = {
    .identity_generated = false,
    .prov_committed = false,
    .prov_mode = PROV_MODE_UNPROVISIONED,
    .cal_kp = 1.74f,
    .cal_ti = 6.01f,
    .cal_td = 0.0f,
    .cal_tf = 0.1f,
    .cal_kb = 1.0f,
    .hw_version = "",
    .hw_comment = "",
    .test_led_status = 0,
    .test_temp_status = 0,
    .checklist_label = false,
    .checklist_sealed = false
};

// mTLS credentials (loaded from NVS at boot)
char *s_mtls_cert = NULL;
char *s_mtls_key = NULL;