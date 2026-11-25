#include "nvs_config.h"
#include "helpers.h"
#include "provisioning.h"

static const char *TAG = "nvs_config";

// Load provisioning state from NVS at boot
// This loads keypair, derived serial, mode, and committed state if device was provisioned
void init_provisioning_state(void)
{
    nvs_handle_t handle;
    esp_err_t err;

    err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        ESP_LOGI(TAG, "No provisioning state in NVS");
        return;
    }

    // Check if private key exists (indicates device was provisioned)
    size_t key_len = 0;
    err = nvs_get_blob(handle, NVS_KEY_PRIVATE_KEY, NULL, &key_len);
    if (err != ESP_OK || key_len == 0 || key_len >= 512) {
        nvs_close(handle);
        ESP_LOGI(TAG, "No provisioning keypair found");
        return;
    }

    // Load the private key
    uint8_t *key_blob = malloc(key_len);
    if (!key_blob) {
        nvs_close(handle);
        ESP_LOGE(TAG, "Failed to allocate memory for key");
        return;
    }

    err = nvs_get_blob(handle, NVS_KEY_PRIVATE_KEY, key_blob, &key_len);
    if (err != ESP_OK) {
        free(key_blob);
        nvs_close(handle);
        ESP_LOGE(TAG, "Failed to load private key");
        return;
    }

    // Import the stored private scalar into PSA
    err = device_key_import(key_blob, key_len);
    memset(key_blob, 0, key_len);
    free(key_blob);
    s_prov_crypto_initialized = true;  // Mark crypto as initialized

    if (err != ESP_OK) {
        nvs_close(handle);
        ESP_LOGE(TAG, "Failed to import private key: %s", esp_err_to_name(err));
        return;
    }

    // Derive serial from public key
    if (prov_derive_serial_from_pubkey() != 0) {
        nvs_close(handle);
        ESP_LOGE(TAG, "Failed to derive serial from pubkey");
        return;
    }

    // Mark identity as generated
    s_prov_state.identity_generated = true;

    // Load provisioning mode and committed state
    uint8_t mode_val = 0, committed_val = 0;
    nvs_get_u8(handle, NVS_KEY_PROV_MODE, &mode_val);
    nvs_get_u8(handle, NVS_KEY_PROV_COMMITTED, &committed_val);
    s_prov_state.prov_mode = (prov_mode_t)mode_val;
    s_prov_state.prov_committed = (committed_val != 0);

    // Load calibration values if present
    size_t float_size = sizeof(float);
    nvs_get_blob(handle, NVS_KEY_CAL_KP, &s_prov_state.cal_kp, &float_size);
    float_size = sizeof(float);
    nvs_get_blob(handle, NVS_KEY_CAL_TI, &s_prov_state.cal_ti, &float_size);
    float_size = sizeof(float);
    nvs_get_blob(handle, NVS_KEY_CAL_TD, &s_prov_state.cal_td, &float_size);
    float_size = sizeof(float);
    nvs_get_blob(handle, NVS_KEY_CAL_TF, &s_prov_state.cal_tf, &float_size);
    float_size = sizeof(float);
    nvs_get_blob(handle, NVS_KEY_CAL_KB, &s_prov_state.cal_kb, &float_size);

    // Load HW version/comment if present
    size_t str_len = sizeof(s_prov_state.hw_version);
    nvs_get_str(handle, NVS_KEY_HW_VERSION, s_prov_state.hw_version, &str_len);
    str_len = sizeof(s_prov_state.hw_comment);
    nvs_get_str(handle, NVS_KEY_HW_COMMENT, s_prov_state.hw_comment, &str_len);

    // Load mTLS cert and key if present
    size_t mtls_len = 0;
    if (nvs_get_str(handle, NVS_KEY_MTLS_CERT, NULL, &mtls_len) == ESP_OK && mtls_len > 0) {
        s_mtls_cert = malloc(mtls_len);
        if (s_mtls_cert) {
            nvs_get_str(handle, NVS_KEY_MTLS_CERT, s_mtls_cert, &mtls_len);
            // Strip \r from PEM (mbedtls wants LF-only)
            for (char *r = s_mtls_cert, *w = s_mtls_cert; ; r++) {
                if (*r != '\r') *w++ = *r;
                if (!*r) break;
            }
            ESP_LOGI(TAG, "Loaded mTLS cert from NVS (%d bytes)", strlen(s_mtls_cert));
        }
    }
    mtls_len = 0;
    if (nvs_get_str(handle, NVS_KEY_MTLS_KEY, NULL, &mtls_len) == ESP_OK && mtls_len > 0) {
        s_mtls_key = malloc(mtls_len);
        if (s_mtls_key) {
            nvs_get_str(handle, NVS_KEY_MTLS_KEY, s_mtls_key, &mtls_len);
            for (char *r = s_mtls_key, *w = s_mtls_key; ; r++) {
                if (*r != '\r') *w++ = *r;
                if (!*r) break;
            }
            ESP_LOGI(TAG, "Loaded mTLS key from NVS (%d bytes)", strlen(s_mtls_key));
        }
    }

    nvs_close(handle);

    ESP_LOGI(TAG, "Loaded provisioning state: serial=%s, mode=%d, committed=%d",
             s_device_serial, s_prov_state.prov_mode, s_prov_state.prov_committed);
}

esp_err_t nvs_save_string(const char *key, const char *value)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    err = nvs_set_str(handle, key, value);
    if (err == ESP_OK) {
        err = nvs_commit(handle);
    }
    nvs_close(handle);
    return err;
}

esp_err_t nvs_save_config(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open NVS: %s", esp_err_to_name(err));
        return err;
    }

    nvs_set_str(handle, NVS_KEY_MODE, s_setup_mode);
    nvs_set_str(handle, NVS_KEY_DEVICE_NAME, s_device_name);
    nvs_set_str(handle, NVS_KEY_PASSWORD, s_device_password);
    nvs_set_str(handle, NVS_KEY_WIFI_SSID, s_wifi_ssid);
    nvs_set_str(handle, NVS_KEY_WIFI_PASS, s_wifi_password);
    nvs_set_u8(handle, NVS_KEY_CONFIGURED, s_setup_committed ? 1 : 0);

    err = nvs_commit(handle);
    nvs_close(handle);

    ESP_LOGI(TAG, "Configuration saved to NVS");
    return err;
}

void nvs_load_config(void)
{
    nvs_handle_t handle;
    if (nvs_open(NVS_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) {
        return;
    }

    size_t len;
    len = sizeof(s_setup_mode);
    nvs_get_str(handle, NVS_KEY_MODE, s_setup_mode, &len);

    len = sizeof(s_device_name);
    nvs_get_str(handle, NVS_KEY_DEVICE_NAME, s_device_name, &len);

    len = sizeof(s_device_password);
    nvs_get_str(handle, NVS_KEY_PASSWORD, s_device_password, &len);

    len = sizeof(s_wifi_ssid);
    nvs_get_str(handle, NVS_KEY_WIFI_SSID, s_wifi_ssid, &len);

    len = sizeof(s_wifi_password);
    nvs_get_str(handle, NVS_KEY_WIFI_PASS, s_wifi_password, &len);

    uint8_t configured = 0;
    nvs_get_u8(handle, NVS_KEY_CONFIGURED, &configured);
    s_setup_committed = (configured != 0);

    uint8_t buzzer_val = 1, wifi_val = 0;
    nvs_get_u8(handle, NVS_KEY_BUZZER, &buzzer_val);
    nvs_get_u8(handle, NVS_KEY_WIFI_EN, &wifi_val);
    s_setting_buzzer = (buzzer_val != 0);
    s_setting_wifi = (wifi_val != 0);

    nvs_close(handle);

    ESP_LOGI(TAG, "Loaded config: mode=%s, name=%s, ssid=%s, committed=%d",
             s_setup_mode, s_device_name, s_wifi_ssid, s_setup_committed);
}

esp_err_t nvs_save_settings(void)
{
    nvs_handle_t handle;
    esp_err_t err = nvs_open(NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) return err;

    nvs_set_u8(handle, NVS_KEY_BUZZER, s_setting_buzzer ? 1 : 0);
    nvs_set_u8(handle, NVS_KEY_WIFI_EN, s_setting_wifi ? 1 : 0);

    err = nvs_commit(handle);
    nvs_close(handle);
    return err;
}
