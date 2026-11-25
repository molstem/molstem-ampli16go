#include "provisioning.h"
#include "helpers.h"
#include "scpi_line.h"
#include "esp_app_desc.h"

static const char *TAG = "provisioning";

// Static buffers for serial derivation and key generation (to avoid stack overflow)
static uint8_t s_serial_pub_der[DEVICE_KEY_SPKI_LEN];
static uint8_t s_serial_hash[32];
static char s_serial_suffix[16];
static uint8_t s_prov_priv_key[DEVICE_KEY_PRIV_LEN];

// Static buffers for PROV:IDEN? response (to avoid stack overflow)
static char s_identity_pub_pem[256];
static char s_identity_pub_pem_escaped[512];
static char s_identity_nonce_hex[65];

// Static buffers for attestation (to avoid stack overflow)
static char s_att_mtls_cert[2048];
static char s_att_pa_pubkey[512];
static char s_att_pub_pem[256];
static char s_att_pub_pem_esc[512];
static char s_att_mtls_cert_esc[4096];
static char s_att_pa_pubkey_esc[1024];
static char s_att_data[8192];

// Local UART buffer (shared with ws_bridge)
static uint8_t s_local_uart_buf[UART_BUF_SIZE];

// Shared SCPI parser context for the provisioning line protocol. Sized by
// SCPI_LINE_MAX / SCPI_OUT_MAX (4096 on the ESP32, see main/CMakeLists.txt).
static scpi_ctx_t s_prov_scpi;

// Forward declarations
static void escape_newlines(const char *src, char *dst, size_t dst_size);
static esp_err_t prov_crypto_init(void);
static esp_err_t prov_generate_identity(void);
static esp_err_t prov_get_public_key_pem(char *pem_buf, size_t buf_size);

// Emit one response line over UART: query data, "OK" or ERR <code>,"<msg>".
// At this point ctx->line holds the request header (the dispatcher NUL-
// terminates it in place), which makes for a useful one-line trace.
static void prov_emit_line(const char *line, void *arg)
{
    (void)arg;
    uart_write_bytes(UART_NUM, line, strlen(line));
    uart_write_bytes(UART_NUM, "\n", 1);
    if (strlen(line) <= 200) {
        ESP_LOGI(TAG, "[PROV] %s -> %s", s_prov_scpi.line, line);
    } else {
        ESP_LOGI(TAG, "[PROV] %s -> %.60s... (%u bytes)", s_prov_scpi.line, line, (unsigned)strlen(line));
    }
}

// Handler helper: set the error message and return the SCPI error code.
static int prov_fail(char *out, size_t out_cap, int code, const char *msg)
{
    snprintf(out, out_cap, "%s", msg);
    return code;
}

// Send debug message over provisioning serial (visible in browser console)
static void prov_debug(const char *msg)
{
    //char buf[128];
    //snprintf(buf, sizeof(buf), "DEBUG %s\n", msg);
    //uart_write_bytes(UART_NUM, buf, strlen(buf));
    //uart_wait_tx_done(UART_NUM, pdMS_TO_TICKS(100));  // Flush to ensure message is sent
}

static esp_err_t prov_crypto_init(void)
{
    prov_debug("crypto_init: entry");

    if (s_prov_crypto_initialized) {
        prov_debug("crypto_init: already initialized");
        return ESP_OK;
    }

    // PSA seeds itself from the ESP32 hardware RNG; no DRBG to set up here.
    prov_debug("crypto_init: psa_crypto_init");
    esp_err_t err = device_key_crypto_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to initialize PSA crypto");
        prov_debug("crypto_init: PSA init failed");
        return err;
    }

    s_prov_crypto_initialized = true;
    prov_debug("crypto_init: done");
    return ESP_OK;
}

// Derive serial from public key (SHA-256 hash -> base32)
// Returns 0 on success, -1 on failure
int prov_derive_serial_from_pubkey(void)
{
    prov_debug("derive_serial: entry");

    char dbg[64];

    if (!device_key_is_loaded()) {
        prov_debug("derive_serial: no key loaded");
        snprintf(s_device_serial, sizeof(s_device_serial), "MOLSTEM-ERROR");
        return -1;
    }

    prov_debug("derive_serial: exporting SPKI");

    // Export public key as SubjectPublicKeyInfo DER
    if (device_key_export_spki(s_serial_pub_der) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to export public key for serial derivation");
        snprintf(s_device_serial, sizeof(s_device_serial), "MOLSTEM-ERROR");
        return -1;
    }

    prov_debug("derive_serial: calling sha256");

    // Derive serial from SHA-256 of public key (first 6 bytes -> 10 base32 chars)
    if (crypto_sha256(s_serial_pub_der, DEVICE_KEY_SPKI_LEN, s_serial_hash) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to hash public key for serial derivation");
        snprintf(s_device_serial, sizeof(s_device_serial), "MOLSTEM-ERROR");
        return -1;
    }

    prov_debug("derive_serial: calling encode_base32");

    // Encode first 6 bytes as base32 (48 bits = 10 chars with 2 bits padding)
    encode_base32(s_serial_hash, 6, s_serial_suffix, sizeof(s_serial_suffix));
    s_serial_suffix[10] = '\0';  // Truncate to 10 chars

    snprintf(s_device_serial, sizeof(s_device_serial), "MOLSTEM-%s", s_serial_suffix);

    snprintf(dbg, sizeof(dbg), "derive_serial: done, serial=%s", s_device_serial);
    prov_debug(dbg);

    return 0;
}

// Generate or load device identity (P-256 keypair + serial)
static esp_err_t prov_generate_identity(void)
{
    char dbg[64];
    snprintf(dbg, sizeof(dbg), "gen_identity: entry, generated=%d", s_prov_state.identity_generated);
    prov_debug(dbg);

    if (s_prov_state.identity_generated) {
        prov_debug("gen_identity: already have identity");
        return ESP_OK;  // Already have identity
    }

    esp_err_t err;
    nvs_handle_t handle;
    bool need_generate = true;
    bool need_erase = false;

    // Try to load existing keys from nvs_factory
    prov_debug("gen_identity: opening nvs_factory");
    err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err == ESP_OK) {
        prov_debug("gen_identity: nvs opened, checking key");
        // Check if private key exists
        size_t key_len = 0;
        err = nvs_get_blob(handle, NVS_KEY_PRIVATE_KEY, NULL, &key_len);
        snprintf(dbg, sizeof(dbg), "gen_identity: key_len=%d, err=%d", (int)key_len, (int)err);
        prov_debug(dbg);
        if (err == ESP_OK && key_len > 0 && key_len < 512) {
            // Load existing key
            prov_debug("gen_identity: loading key blob");
            uint8_t *key_blob = malloc(key_len);
            if (key_blob) {
                err = nvs_get_blob(handle, NVS_KEY_PRIVATE_KEY, key_blob, &key_len);
                snprintf(dbg, sizeof(dbg), "gen_identity: loaded, err=%d", (int)err);
                prov_debug(dbg);
                if (err == ESP_OK) {
                    // Import the stored private scalar
                    snprintf(dbg, sizeof(dbg), "gen_identity: importing key, len=%d", (int)key_len);
                    prov_debug(dbg);
                    esp_err_t import_err = device_key_import(key_blob, key_len);
                    snprintf(dbg, sizeof(dbg), "gen_identity: import err=%d", (int)import_err);
                    prov_debug(dbg);
                    if (import_err == ESP_OK) {
                        // Derive serial from the loaded public key
                        prov_debug("gen_identity: deriving serial");
                        if (prov_derive_serial_from_pubkey() == 0) {
                            snprintf(dbg, sizeof(dbg), "gen_identity: serial=%s", s_device_serial);
                            prov_debug(dbg);
                            prov_debug("gen_identity: setting flags");
                            s_prov_state.identity_generated = true;
                            need_generate = false;

                            // Load prov_mode and prov_committed from NVS
                            uint8_t mode_val = 0, committed_val = 0;
                            nvs_get_u8(handle, NVS_KEY_PROV_MODE, &mode_val);
                            nvs_get_u8(handle, NVS_KEY_PROV_COMMITTED, &committed_val);
                            s_prov_state.prov_mode = (prov_mode_t)mode_val;
                            s_prov_state.prov_committed = (committed_val != 0);
                            snprintf(dbg, sizeof(dbg), "gen_identity: mode=%d, committed=%d", mode_val, committed_val);
                            prov_debug(dbg);

                            prov_debug("gen_identity: flags set");
                        } else {
                            prov_debug("gen_identity: derive failed, will regen");
                            need_erase = true;
                        }
                    } else {
                        prov_debug("gen_identity: import failed, will regen");
                        need_erase = true;
                    }
                }
                prov_debug("gen_identity: freeing key_blob");
                free(key_blob);
                prov_debug("gen_identity: key_blob freed");
            } else {
                prov_debug("gen_identity: malloc failed");
            }
        }
        prov_debug("gen_identity: closing nvs");
        nvs_close(handle);
        prov_debug("gen_identity: nvs closed");
    } else {
        snprintf(dbg, sizeof(dbg), "gen_identity: nvs open failed, err=%d", (int)err);
        prov_debug(dbg);
    }

    snprintf(dbg, sizeof(dbg), "gen_identity: need_erase=%d, need_gen=%d", need_erase, need_generate);
    prov_debug(dbg);

    // Erase corrupt key if needed
    if (need_erase) {
        prov_debug("gen_identity: erasing corrupt key");
        nvs_handle_t erase_handle;
        if (nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &erase_handle) == ESP_OK) {
            nvs_erase_key(erase_handle, NVS_KEY_PRIVATE_KEY);
            nvs_commit(erase_handle);
            nvs_close(erase_handle);
            prov_debug("gen_identity: corrupt key erased");
        }
    }

    // Return early if we successfully loaded the key
    if (!need_generate) {
        prov_debug("gen_identity: returning OK (loaded existing)");
        return ESP_OK;
    }

    prov_debug("gen_identity: need to generate new key");

    // Generate new P-256 keypair
    ESP_LOGI(TAG, "Generating new P-256 keypair...");

    if (device_key_generate(s_prov_priv_key) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to generate EC key");
        return ESP_FAIL;
    }

    // Derive serial from public key
    if (prov_derive_serial_from_pubkey() != 0) {
        ESP_LOGE(TAG, "Failed to derive serial from newly generated key");
        return ESP_FAIL;
    }
    ESP_LOGI(TAG, "Generated device serial: %s", s_device_serial);

    // Store private key in nvs_factory (serial is derived, not stored)
    err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to open nvs_factory for writing: %s", esp_err_to_name(err));
        return ESP_FAIL;
    }

    err = nvs_set_blob(handle, NVS_KEY_PRIVATE_KEY, s_prov_priv_key, sizeof(s_prov_priv_key));
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to store private key: %s", esp_err_to_name(err));
        nvs_close(handle);
        return ESP_FAIL;
    }

    err = nvs_commit(handle);
    nvs_close(handle);
    memset(s_prov_priv_key, 0, sizeof(s_prov_priv_key));

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to commit nvs_factory: %s", esp_err_to_name(err));
        return ESP_FAIL;
    }

    s_prov_state.identity_generated = true;
    ESP_LOGI(TAG, "Identity generated and stored successfully");
    return ESP_OK;
}

// Get public key in PEM format
static esp_err_t prov_get_public_key_pem(char *pem_buf, size_t buf_size)
{
    // Write public key to PEM
    esp_err_t err = device_key_export_pem(pem_buf, buf_size);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Failed to write public key PEM");
        return ESP_FAIL;
    }
    return ESP_OK;
}

// Helper to escape newlines for JSON into a buffer
static void escape_newlines(const char *src, char *dst, size_t dst_size)
{
    size_t i, j;
    for (i = 0, j = 0; src[i] && j < dst_size - 2; i++) {
        if (src[i] == '\n') {
            dst[j++] = '\\';
            dst[j++] = 'n';
        } else if (src[i] != '\r') {
            dst[j++] = src[i];
        }
    }
    dst[j] = '\0';
}

// ============ PROV command handlers (scpi_handler_fn) ============
//
// Return SCPI_OK with `out` filled for a query (bare JSON / text line) or
// empty for "OK"; return an error code (message in `out`) for ERR.

// *IDN? -> molstem,thermocycler-provisioning,<serial or empty>,<ESP app version>
static int prov_cmd_idn(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx; (void)args;
    const char *serial = s_prov_state.identity_generated ? s_device_serial : "";
    const esp_app_desc_t *desc = esp_app_get_description();
    snprintf(out, out_cap, "molstem,thermocycler-provisioning,%s,%s",
             serial, desc ? desc->version : "");
    return SCPI_OK;
}

// PROV:IDEN? -> identity JSON
static int prov_cmd_identity(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx; (void)args;
    prov_debug("PROV:IDEN?: entry");

    prov_debug("PROV:IDEN?: crypto init");
    if (prov_crypto_init() != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Failed to initialize crypto");
    }

    prov_debug("PROV:IDEN?: gen identity");
    if (prov_generate_identity() != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Failed to generate identity");
    }

    prov_debug("PROV:IDEN?: gen_identity returned OK");

    prov_debug("PROV:IDEN?: getting MAC");
    // Get WiFi MAC address
    uint8_t mac[6];
    esp_err_t mac_err = esp_wifi_get_mac(WIFI_IF_STA, mac);
    char dbg[64];
    snprintf(dbg, sizeof(dbg), "PROV:IDEN?: mac err=%d", (int)mac_err);
    prov_debug(dbg);

    char mac_str[18];
    snprintf(mac_str, sizeof(mac_str), "%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

    prov_debug("PROV:IDEN?: getting chip info");
    // Get chip ID
    esp_chip_info_t chip_info;
    esp_chip_info(&chip_info);
    char chip_id[32];
    snprintf(chip_id, sizeof(chip_id), "ESP32-%d", chip_info.revision);

    prov_debug("PROV:IDEN?: generating nonce");
    // Generate nonce (32 bytes hex = 64 chars)
    uint8_t nonce_bytes[32];
    esp_fill_random(nonce_bytes, sizeof(nonce_bytes));
    for (int i = 0; i < 32; i++) {
        snprintf(&s_identity_nonce_hex[i * 2], 3, "%02x", nonce_bytes[i]);
    }

    prov_debug("PROV:IDEN?: getting pub key PEM");
    // Get public key PEM (using static buffer)
    if (prov_get_public_key_pem(s_identity_pub_pem, sizeof(s_identity_pub_pem)) != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Failed to get public key");
    }

    prov_debug("PROV:IDEN?: escaping PEM");
    // Escape newlines in PEM for JSON (using static buffer)
    size_t j = 0;
    for (size_t i = 0; s_identity_pub_pem[i] && j < sizeof(s_identity_pub_pem_escaped) - 2; i++) {
        if (s_identity_pub_pem[i] == '\n') {
            s_identity_pub_pem_escaped[j++] = '\\';
            s_identity_pub_pem_escaped[j++] = 'n';
        } else if (s_identity_pub_pem[i] != '\r') {
            s_identity_pub_pem_escaped[j++] = s_identity_pub_pem[i];
        }
    }
    s_identity_pub_pem_escaped[j] = '\0';

    prov_debug("PROV:IDEN?: building JSON");
    // Build JSON response straight into the reply line
    snprintf(out, out_cap,
             "{\"serial\":\"%s\",\"publicKey\":\"%s\",\"wifiMac\":\"%s\",\"chipId\":\"%s\",\"nonce\":\"%s\"}",
             s_device_serial, s_identity_pub_pem_escaped, mac_str, chip_id, s_identity_nonce_hex);

    prov_debug("PROV:IDEN?: done");
    return SCPI_OK;
}

// PROV:CAL <kp>,<ti>,<td>,<tf>,<kb>
static int prov_cmd_calibration(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 5) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Expected 5 floats: kp,ti,td,tf,kb");
    }

    float kp, ti, td, tf, kb;
    if (!scpi_arg_float(args, 0, &kp) || !scpi_arg_float(args, 1, &ti) ||
        !scpi_arg_float(args, 2, &td) || !scpi_arg_float(args, 3, &tf) ||
        !scpi_arg_float(args, 4, &kb)) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Expected 5 floats: kp,ti,td,tf,kb");
    }

    // Validate ranges (0-100)
    if (kp < 0 || kp > 100 || ti < 0 || ti > 100 || td < 0 || td > 100 ||
        tf < 0 || tf > 100 || kb < 0 || kb > 100) {
        return prov_fail(out, out_cap, SCPI_ERR_OUT_OF_RANGE, "Calibration values must be 0-100");
    }

    // Store in nvs_factory
    nvs_handle_t handle;
    esp_err_t err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to open NVS");
    }

    // Store each float as a blob (4 bytes)
    nvs_set_blob(handle, NVS_KEY_CAL_KP, &kp, sizeof(float));
    nvs_set_blob(handle, NVS_KEY_CAL_TI, &ti, sizeof(float));
    nvs_set_blob(handle, NVS_KEY_CAL_TD, &td, sizeof(float));
    nvs_set_blob(handle, NVS_KEY_CAL_TF, &tf, sizeof(float));
    nvs_set_blob(handle, NVS_KEY_CAL_KB, &kb, sizeof(float));

    err = nvs_commit(handle);
    nvs_close(handle);

    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to commit NVS");
    }

    // Update in-memory state
    s_prov_state.cal_kp = kp;
    s_prov_state.cal_ti = ti;
    s_prov_state.cal_td = td;
    s_prov_state.cal_tf = tf;
    s_prov_state.cal_kb = kb;

    ESP_LOGI(TAG, "Calibration set: kp=%.3f ti=%.3f td=%.3f tf=%.3f kb=%.3f", kp, ti, td, tf, kb);
    return SCPI_OK;
}

// PROV:HWV <base64 json>
static int prov_cmd_hw_version(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 1 || !args->argv[0][0]) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Missing payload");
    }
    const char *payload = args->argv[0];

    // Decode base64
    char decoded[512];
    int decoded_len = base64_decode(payload, strlen(payload), decoded, sizeof(decoded) - 1);
    if (decoded_len <= 0) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Invalid base64");
    }
    decoded[decoded_len] = '\0';

    // Parse JSON
    char hw_version[32] = {0};
    char hw_comment[128] = {0};

    json_get_string(decoded, "hwVersion", hw_version, sizeof(hw_version));
    json_get_string(decoded, "hwComment", hw_comment, sizeof(hw_comment));

    if (!hw_version[0]) {
        return prov_fail(out, out_cap, SCPI_ERR_OUT_OF_RANGE, "hwVersion is required");
    }

    // Store in nvs_factory
    nvs_handle_t handle;
    esp_err_t err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to open NVS");
    }

    nvs_set_str(handle, NVS_KEY_HW_VERSION, hw_version);
    if (hw_comment[0]) {
        nvs_set_str(handle, NVS_KEY_HW_COMMENT, hw_comment);
    }

    err = nvs_commit(handle);
    nvs_close(handle);

    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to commit NVS");
    }

    // Update in-memory state
    safe_strcpy(s_prov_state.hw_version, hw_version, sizeof(s_prov_state.hw_version));
    safe_strcpy(s_prov_state.hw_comment, hw_comment, sizeof(s_prov_state.hw_comment));

    ESP_LOGI(TAG, "HW version set: %s (comment: %s)", hw_version, hw_comment);
    return SCPI_OK;
}

// PROV:MODE DEVELOPMENT|PRODUCTION
static int prov_cmd_mode(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 1 || !args->argv[0][0]) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Missing mode");
    }

    prov_mode_t mode;
    if (scpi_arg_eq(args, 0, "DEVELOPMENT")) {
        mode = PROV_MODE_DEVELOPMENT;
    } else if (scpi_arg_eq(args, 0, "PRODUCTION")) {
        mode = PROV_MODE_PRODUCTION;
    } else {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Mode must be DEVELOPMENT or PRODUCTION");
    }

    // Allow re-provisioning if in development mode, block if committed in production
    if (s_prov_state.prov_committed && s_prov_state.prov_mode == PROV_MODE_PRODUCTION) {
        return prov_fail(out, out_cap, SCPI_ERR_ALREADY_PROV, "Device is provisioned in production mode");
    }

    // If re-provisioning in development mode, reset committed state
    if (s_prov_state.prov_committed) {
        s_prov_state.prov_committed = false;
        ESP_LOGI(TAG, "Re-provisioning: resetting committed state");
    }

    // Store pending mode (not committed until signoff)
    s_prov_state.prov_mode = mode;
    ESP_LOGI(TAG, "Provision mode set: %s", mode == PROV_MODE_PRODUCTION ? "PRODUCTION" : "DEVELOPMENT");
    return SCPI_OK;
}

// PROV:MODE? -> DEVELOPMENT / PRODUCTION / UNPROVISIONED
static int prov_cmd_mode_query(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx; (void)args;
    const char *name;
    switch (s_prov_state.prov_mode) {
    case PROV_MODE_DEVELOPMENT: name = "DEVELOPMENT"; break;
    case PROV_MODE_PRODUCTION:  name = "PRODUCTION"; break;
    default:                    name = "UNPROVISIONED"; break;
    }
    snprintf(out, out_cap, "%s", name);
    return SCPI_OK;
}

// PROV:TEST? -> tests JSON
static int prov_cmd_tests_query(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx; (void)args;
    // Return mock hardware tests
    const char *json = "{\"tests\":["
        "{\"id\":\"led_test\",\"name\":\"LED Indicator Test\",\"description\":\"Verify LED blinks correctly\",\"type\":\"observe_confirm\",\"status\":\"%s\"},"
        "{\"id\":\"temp_sensor\",\"name\":\"Temperature Sensor Check\",\"description\":\"Verify temperature reading is reasonable\",\"type\":\"observe_confirm\",\"status\":\"%s\"}"
        "]}";

    const char *status_names[] = {"pending", "passed", "failed"};
    snprintf(out, out_cap, json,
             status_names[s_prov_state.test_led_status],
             status_names[s_prov_state.test_temp_status]);
    return SCPI_OK;
}

// PROV:TEST <id>,START|PASS|FAIL
static int prov_cmd_test(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 2) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Expected: <test_id>,START|PASS|FAIL");
    }
    const char *test_id = args->argv[0];

    uint8_t status;
    if (scpi_arg_eq(args, 1, "PASS")) {
        status = 1;
    } else if (scpi_arg_eq(args, 1, "FAIL")) {
        status = 2;
    } else if (scpi_arg_eq(args, 1, "START")) {
        status = 0;  // Reset to pending
    } else {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Action must be START, PASS or FAIL");
    }

    if (strcmp(test_id, "led_test") == 0) {
        s_prov_state.test_led_status = status;
    } else if (strcmp(test_id, "temp_sensor") == 0) {
        s_prov_state.test_temp_status = status;
    } else {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Unknown test id");
    }

    ESP_LOGI(TAG, "Test %s: %s", test_id, args->argv[1]);
    return SCPI_OK;
}

// PROV:CHEC? -> checklist JSON
static int prov_cmd_checklist_query(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx; (void)args;
    snprintf(out, out_cap,
             "{\"items\":["
             "{\"id\":\"label\",\"description\":\"Serial number label applied to device\",\"completed\":%s},"
             "{\"id\":\"sealed\",\"description\":\"Device enclosure properly sealed\",\"completed\":%s}"
             "]}",
             s_prov_state.checklist_label ? "true" : "false",
             s_prov_state.checklist_sealed ? "true" : "false");
    return SCPI_OK;
}

// PROV:CHEC <id>,0|1
static int prov_cmd_checklist(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 2) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Expected: <item_id>,0|1");
    }
    const char *item_id = args->argv[0];

    long value = 0;
    if (!scpi_arg_int(args, 1, &value) || (value != 0 && value != 1)) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Value must be 0 or 1");
    }

    if (strcmp(item_id, "label") == 0) {
        s_prov_state.checklist_label = (value != 0);
    } else if (strcmp(item_id, "sealed") == 0) {
        s_prov_state.checklist_sealed = (value != 0);
    } else {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Unknown checklist item");
    }

    ESP_LOGI(TAG, "Checklist %s: %ld", item_id, value);
    return SCPI_OK;
}

// PROV:MTLS <base64 KeyExchangePayload>
static int prov_cmd_mtls(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 1 || !args->argv[0][0]) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Missing payload");
    }
    const char *payload = args->argv[0];

    if (!s_prov_state.identity_generated) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Identity not generated yet");
    }

    // Decode base64
    char *decoded = malloc(4096);
    if (!decoded) {
        return prov_fail(out, out_cap, SCPI_ERR_NO_MEMORY, "Out of memory");
    }

    int decoded_len = base64_decode(payload, strlen(payload), decoded, 4095);
    if (decoded_len <= 0) {
        free(decoded);
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Invalid base64");
    }
    decoded[decoded_len] = '\0';

    // Parse JSON to extract fields
    static char mtls_cert[2048] = {0};
    static char encrypted_key[512] = {0};
    static char ephemeral_pub[256] = {0};
    static char iv[64] = {0};
    static char auth_tag[64] = {0};
    static char pa_pubkey[512] = {0};

    json_get_string(decoded, "mtlsCert", mtls_cert, sizeof(mtls_cert));
    json_get_string(decoded, "encryptedKey", encrypted_key, sizeof(encrypted_key));
    json_get_string(decoded, "ephemeralPubKey", ephemeral_pub, sizeof(ephemeral_pub));
    json_get_string(decoded, "iv", iv, sizeof(iv));
    json_get_string(decoded, "authTag", auth_tag, sizeof(auth_tag));
    json_get_string(decoded, "paPubKey", pa_pubkey, sizeof(pa_pubkey));

    free(decoded);

    if (!mtls_cert[0] || !encrypted_key[0] || !ephemeral_pub[0] || !iv[0] || !auth_tag[0] || !pa_pubkey[0]) {
        return prov_fail(out, out_cap, SCPI_ERR_OUT_OF_RANGE, "Missing required fields");
    }

    // Strip \r from PEM strings (mbedtls wants LF-only)
    for (char *r = mtls_cert, *w = mtls_cert; ; r++) {
        if (*r != '\r') *w++ = *r;
        if (!*r) break;
    }
    for (char *r = pa_pubkey, *w = pa_pubkey; ; r++) {
        if (*r != '\r') *w++ = *r;
        if (!*r) break;
    }

    // --- ECIES decryption of mTLS private key ---
    // Scheme: ECDH(device_priv, ephemeral_pub) -> SHA-256 -> AES-256-GCM

    // Decode base64 fields to binary
    uint8_t eph_spki[128];
    int eph_spki_len = base64_decode(ephemeral_pub, strlen(ephemeral_pub), (char *)eph_spki, sizeof(eph_spki));
    if (eph_spki_len <= 0) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Invalid ephemeral pubkey base64");
    }

    uint8_t enc_key_bin[2048];
    int enc_key_len = base64_decode(encrypted_key, strlen(encrypted_key), (char *)enc_key_bin, sizeof(enc_key_bin));
    if (enc_key_len <= 0) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Invalid encrypted key base64");
    }

    uint8_t iv_bin[12];
    int iv_len = base64_decode(iv, strlen(iv), (char *)iv_bin, sizeof(iv_bin));
    if (iv_len != 12) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Invalid IV (expected 12 bytes)");
    }

    uint8_t tag_bin[16];
    int tag_len = base64_decode(auth_tag, strlen(auth_tag), (char *)tag_bin, sizeof(tag_bin));
    if (tag_len != 16) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Invalid auth tag (expected 16 bytes)");
    }

    // ECDH between the device key and the ephemeral public key (SPKI DER)
    uint8_t shared_bytes[32];
    esp_err_t crypto_err = device_key_ecdh(eph_spki, eph_spki_len, shared_bytes);
    if (crypto_err != ESP_OK) {
        ESP_LOGE(TAG, "ECDH failed: %s", esp_err_to_name(crypto_err));
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "ECDH failed");
    }

    // SHA-256(shared_secret) -> AES key
    uint8_t aes_key[32];
    if (crypto_sha256(shared_bytes, sizeof(shared_bytes), aes_key) != ESP_OK) {
        memset(shared_bytes, 0, sizeof(shared_bytes));
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Key derivation failed");
    }

    uint8_t *decrypted = malloc(enc_key_len + 1);
    if (!decrypted) {
        memset(aes_key, 0, sizeof(aes_key));
        memset(shared_bytes, 0, sizeof(shared_bytes));
        return prov_fail(out, out_cap, SCPI_ERR_NO_MEMORY, "Out of memory");
    }

    // AES-256-GCM decrypt, no AAD
    crypto_err = crypto_aes256_gcm_decrypt(aes_key, iv_bin,
                                           enc_key_bin, enc_key_len,
                                           tag_bin, decrypted);

    // Clear sensitive key material
    memset(aes_key, 0, sizeof(aes_key));
    memset(shared_bytes, 0, sizeof(shared_bytes));

    if (crypto_err != ESP_OK) {
        free(decrypted);
        ESP_LOGE(TAG, "GCM decrypt failed: %s", esp_err_to_name(crypto_err));
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Decryption failed (auth tag mismatch?)");
    }

    decrypted[enc_key_len] = '\0';
    ESP_LOGI(TAG, "mTLS key decrypted successfully (%d bytes)", enc_key_len);

    // Store in nvs_factory
    nvs_handle_t handle;
    esp_err_t err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        free(decrypted);
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to open NVS");
    }

    nvs_set_str(handle, NVS_KEY_MTLS_CERT, mtls_cert);
    nvs_set_str(handle, NVS_KEY_MTLS_KEY, (const char *)decrypted);
    nvs_set_str(handle, NVS_KEY_PA_PUBKEY, pa_pubkey);

    free(decrypted);

    err = nvs_commit(handle);
    nvs_close(handle);

    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to commit NVS");
    }

    // Update in-memory cache
    if (s_mtls_cert) free(s_mtls_cert);
    s_mtls_cert = strdup(mtls_cert);

    // Reload key from NVS into cache
    nvs_handle_t h2;
    if (nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READONLY, &h2) == ESP_OK) {
        size_t klen = 0;
        if (nvs_get_str(h2, NVS_KEY_MTLS_KEY, NULL, &klen) == ESP_OK && klen > 0) {
            if (s_mtls_key) free(s_mtls_key);
            s_mtls_key = malloc(klen);
            nvs_get_str(h2, NVS_KEY_MTLS_KEY, s_mtls_key, &klen);
        }
        nvs_close(h2);
    }

    ESP_LOGI(TAG, "mTLS credentials stored (cert + decrypted key)");
    return SCPI_OK;
}

// PROV:ATT? -> attestation JSON {"data":"<base64>","signature":"<base64>"}
static int prov_cmd_attestation(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx; (void)args;
    if (!s_prov_state.identity_generated) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Identity not generated yet");
    }

    // Get stored values
    nvs_handle_t handle;
    esp_err_t err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READONLY, &handle);
    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to open NVS");
    }

    size_t len;
    memset(s_att_mtls_cert, 0, sizeof(s_att_mtls_cert));
    memset(s_att_pa_pubkey, 0, sizeof(s_att_pa_pubkey));

    len = sizeof(s_att_mtls_cert);
    nvs_get_str(handle, NVS_KEY_MTLS_CERT, s_att_mtls_cert, &len);
    len = sizeof(s_att_pa_pubkey);
    nvs_get_str(handle, NVS_KEY_PA_PUBKEY, s_att_pa_pubkey, &len);
    nvs_close(handle);

    // Get public key PEM
    if (prov_get_public_key_pem(s_att_pub_pem, sizeof(s_att_pub_pem)) != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Failed to get public key");
    }

    // Escape newlines for JSON
    escape_newlines(s_att_pub_pem, s_att_pub_pem_esc, sizeof(s_att_pub_pem_esc));
    escape_newlines(s_att_mtls_cert, s_att_mtls_cert_esc, sizeof(s_att_mtls_cert_esc));
    escape_newlines(s_att_pa_pubkey, s_att_pa_pubkey_esc, sizeof(s_att_pa_pubkey_esc));

    const char *mode_str = (s_prov_state.prov_mode == PROV_MODE_PRODUCTION) ? "production" : "development";

    // Build attestation data
    snprintf(s_att_data, sizeof(s_att_data),
             "{\"serial\":\"%s\",\"publicKey\":\"%s\",\"mtlsCert\":\"%s\",\"paPubKey\":\"%s\","
             "\"calibration\":{\"kp\":%.3f,\"ti\":%.3f,\"td\":%.3f,\"tf\":%.3f,\"kb\":%.3f},"
             "\"hwVersion\":\"%s\",\"hwComment\":\"%s\",\"provisionMode\":\"%s\","
             "\"hardwareTests\":[{\"id\":\"led_test\",\"status\":\"%s\"},{\"id\":\"temp_sensor\",\"status\":\"%s\"}]}",
             s_device_serial, s_att_pub_pem_esc, s_att_mtls_cert_esc, s_att_pa_pubkey_esc,
             s_prov_state.cal_kp, s_prov_state.cal_ti, s_prov_state.cal_td, s_prov_state.cal_tf, s_prov_state.cal_kb,
             s_prov_state.hw_version, s_prov_state.hw_comment, mode_str,
             (s_prov_state.test_led_status == 1) ? "passed" : ((s_prov_state.test_led_status == 2) ? "failed" : "skipped"),
             (s_prov_state.test_temp_status == 1) ? "passed" : ((s_prov_state.test_temp_status == 2) ? "failed" : "skipped"));

    // Hash attestation data
    uint8_t hash[32];
    if (crypto_sha256(s_att_data, strlen(s_att_data), hash) != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Hashing failed");
    }

    // Sign with device private key - PSA returns P1363 (r || s) directly
    uint8_t sig_p1363[DEVICE_KEY_SIG_LEN];
    if (device_key_sign_hash(hash, sig_p1363) != ESP_OK) {
        ESP_LOGE(TAG, "Signing failed");
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Signing failed");
    }

    // Base64 encode signature
    char sig_b64[100];
    size_t sig_b64_len;
    mbedtls_base64_encode((unsigned char *)sig_b64, sizeof(sig_b64), &sig_b64_len,
                          sig_p1363, sizeof(sig_p1363));
    sig_b64[sig_b64_len] = '\0';

    // Base64 encode the data JSON (so backend can verify exact bytes that were signed)
    static char data_b64[4096];
    size_t data_b64_len;
    if (mbedtls_base64_encode((unsigned char *)data_b64, sizeof(data_b64), &data_b64_len,
                              (const unsigned char *)s_att_data, strlen(s_att_data)) != 0) {
        return prov_fail(out, out_cap, SCPI_ERR_NO_MEMORY, "Attestation too large");
    }
    data_b64[data_b64_len] = '\0';

    // Final response: {"data": "<base64>", "signature": "..."} - one line,
    // bounded by SCPI_OUT_MAX; refuse rather than emit truncated JSON.
    int n = snprintf(out, out_cap, "{\"data\":\"%s\",\"signature\":\"%s\"}", data_b64, sig_b64);
    if (n < 0 || (size_t)n >= out_cap) {
        return prov_fail(out, out_cap, SCPI_ERR_NO_MEMORY, "Attestation too large");
    }
    return SCPI_OK;
}

// PROV:SIGN <base64 SignoffPayload> - commits provisioning
static int prov_cmd_signoff(scpi_ctx_t *ctx, const scpi_args_t *args, char *out, size_t out_cap)
{
    (void)ctx;
    if (args->count != 1 || !args->argv[0][0]) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_COUNT, "Missing payload");
    }
    const char *payload = args->argv[0];

    if (!s_prov_state.identity_generated) {
        return prov_fail(out, out_cap, SCPI_ERR_CRYPTO, "Identity not generated yet");
    }

    if (s_prov_state.prov_mode == PROV_MODE_UNPROVISIONED) {
        return prov_fail(out, out_cap, SCPI_ERR_OUT_OF_RANGE, "Provision mode not set");
    }

    // Decode base64
    char decoded[1024];
    int decoded_len = base64_decode(payload, strlen(payload), decoded, sizeof(decoded) - 1);
    if (decoded_len <= 0) {
        return prov_fail(out, out_cap, SCPI_ERR_ARG_VALUE, "Invalid base64");
    }
    decoded[decoded_len] = '\0';

    // Parse signoff fields
    char user_name[128] = {0};
    char date[64] = {0};
    char attestation_hash[128] = {0};
    char signature[256] = {0};

    json_get_string(decoded, "userName", user_name, sizeof(user_name));
    json_get_string(decoded, "date", date, sizeof(date));
    json_get_string(decoded, "attestationHash", attestation_hash, sizeof(attestation_hash));
    json_get_string(decoded, "signature", signature, sizeof(signature));

    if (!user_name[0] || !date[0] || !attestation_hash[0] || !signature[0]) {
        return prov_fail(out, out_cap, SCPI_ERR_OUT_OF_RANGE, "Missing required signoff fields");
    }

    // TODO: Verify PA signature using stored pa_pubkey
    // For now, we'll trust the signoff
    ESP_LOGI(TAG, "Signoff received from: %s at %s", user_name, date);

    // Commit provisioning mode to NVS
    nvs_handle_t handle;
    esp_err_t err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to open NVS");
    }

    uint8_t mode_val = (uint8_t)s_prov_state.prov_mode;
    nvs_set_u8(handle, NVS_KEY_PROV_MODE, mode_val);
    nvs_set_u8(handle, NVS_KEY_PROV_COMMITTED, 1);

    err = nvs_commit(handle);
    nvs_close(handle);

    if (err != ESP_OK) {
        return prov_fail(out, out_cap, SCPI_ERR_STORAGE, "Failed to commit NVS");
    }

    // Mark as committed in memory (the UART task loop exits on this flag)
    s_prov_state.prov_committed = true;

    ESP_LOGI(TAG, "Device provisioned successfully in %s mode",
             (s_prov_state.prov_mode == PROV_MODE_PRODUCTION) ? "production" : "development");

    return SCPI_OK;
}

// Provisioning command table (docs/serial-api.md, "Provisioning commands").
// Only served while the device is unprovisioned; afterwards the STM32 handles
// USB itself and none of these exist.
static const scpi_cmd_t s_prov_cmds[] = {
    { "*IDN?",      prov_cmd_idn,             0, 0 },
    { "PROV:IDEN?", prov_cmd_identity,        0, 0 },
    { "PROV:MTLS",  prov_cmd_mtls,            0, 0 },
    { "PROV:CAL",   prov_cmd_calibration,     0, 0 },
    { "PROV:HWV",   prov_cmd_hw_version,      0, 0 },
    { "PROV:MODE",  prov_cmd_mode,            0, 0 },
    { "PROV:MODE?", prov_cmd_mode_query,      0, 0 },
    { "PROV:TEST?", prov_cmd_tests_query,     0, 0 },
    { "PROV:TEST",  prov_cmd_test,            0, 0 },
    { "PROV:CHEC?", prov_cmd_checklist_query, 0, 0 },
    { "PROV:CHEC",  prov_cmd_checklist,       0, 0 },
    { "PROV:ATT?",  prov_cmd_attestation,     0, 0 },
    { "PROV:SIGN",  prov_cmd_signoff,         0, 0 },
};

void provisioning_uart_task(void *arg)
{
    ESP_LOGI(TAG, "Provisioning UART task started (SCPI PROV: commands)");

    scpi_init(&s_prov_scpi, s_prov_cmds, sizeof(s_prov_cmds) / sizeof(s_prov_cmds[0]), NULL, NULL);

    s_prov_state.prov_committed = false;

    while (!s_prov_state.prov_committed) {
        int len = uart_read_bytes(UART_NUM, s_local_uart_buf, UART_BUF_SIZE, pdMS_TO_TICKS(100));
        if (len > 0) {
            // scpi_feed assembles lines ('\r' ignored, '\n' terminates, empty
            // lines produce no reply) and answers each one through prov_emit_line.
            scpi_feed(&s_prov_scpi, s_local_uart_buf, (size_t)len, prov_emit_line, NULL);
        }
    }

    ESP_LOGI(TAG, "Provisioning complete, UART task exiting");
    vTaskDelete(NULL);
}

void reprovision() {
    if (s_prov_state.prov_mode == PROV_MODE_PRODUCTION) {
        return;
    }

    esp_err_t err;
    nvs_handle_t handle;
    err = nvs_open_from_partition("nvs_factory", NVS_NAMESPACE, NVS_READWRITE, &handle);
    if (err == ESP_OK) {
        nvs_erase_key(handle, NVS_KEY_PROV_MODE);
        nvs_erase_key(handle, NVS_KEY_PROV_COMMITTED);
        nvs_commit(handle);
        nvs_close(handle);
        // ESP_LOGI(TAG, "Device reprovisioning: cleared committed flag");
    }
}
