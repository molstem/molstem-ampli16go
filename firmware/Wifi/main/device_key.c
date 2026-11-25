#include "device_key.h"

#include <stdlib.h>
#include <string.h>

#include "esp_log.h"
#include "mbedtls/base64.h"
#include "psa/crypto.h"

static const char *TAG = "device_key";

static psa_key_id_t s_key_id = PSA_KEY_ID_NULL;
static bool s_psa_ready = false;

// Fixed SubjectPublicKeyInfo prefix for an uncompressed prime256v1 point:
//   SEQUENCE (89 bytes)
//     SEQUENCE (19 bytes)
//       OID 1.2.840.10045.2.1   ecPublicKey
//       OID 1.2.840.10045.3.1.7 prime256v1
//     BIT STRING (66 bytes, 0 unused bits)
// followed by the 65-byte point, for DEVICE_KEY_SPKI_LEN bytes total.
static const uint8_t SPKI_P256_PREFIX[] = {
    0x30, 0x59, 0x30, 0x13,
    0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
    0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07,
    0x03, 0x42, 0x00,
};
#define SPKI_PREFIX_LEN (sizeof(SPKI_P256_PREFIX))

_Static_assert(SPKI_PREFIX_LEN + DEVICE_KEY_POINT_LEN == DEVICE_KEY_SPKI_LEN,
               "P-256 SPKI length mismatch");

esp_err_t device_key_crypto_init(void)
{
    if (s_psa_ready) {
        return ESP_OK;
    }

    // Idempotent in PSA, but ESP-IDF already initializes it during startup.
    psa_status_t st = psa_crypto_init();
    if (st != PSA_SUCCESS) {
        ESP_LOGE(TAG, "psa_crypto_init failed: %d", (int)st);
        return ESP_FAIL;
    }

    s_psa_ready = true;
    return ESP_OK;
}

bool device_key_is_loaded(void)
{
    return s_key_id != PSA_KEY_ID_NULL;
}

void device_key_unload(void)
{
    if (s_key_id != PSA_KEY_ID_NULL) {
        psa_destroy_key(s_key_id);
        s_key_id = PSA_KEY_ID_NULL;
    }
}

// Attributes shared by import and generate: the key both signs (cloud device
// auth, attestation) and does key agreement (provisioning), so ECDH goes in as
// the enrollment algorithm alongside the primary ECDSA policy.
static void device_key_attributes(psa_key_attributes_t *attr)
{
    psa_set_key_usage_flags(attr, PSA_KEY_USAGE_SIGN_HASH |
                                  PSA_KEY_USAGE_DERIVE |
                                  PSA_KEY_USAGE_EXPORT);
    psa_set_key_algorithm(attr, PSA_ALG_ECDSA(PSA_ALG_SHA_256));
    psa_set_key_enrollment_algorithm(attr, PSA_ALG_ECDH);
    psa_set_key_type(attr, PSA_KEY_TYPE_ECC_KEY_PAIR(PSA_ECC_FAMILY_SECP_R1));
    psa_set_key_bits(attr, 256);
}

esp_err_t device_key_import(const uint8_t *priv, size_t priv_len)
{
    if (priv == NULL || priv_len != DEVICE_KEY_PRIV_LEN) {
        ESP_LOGW(TAG, "Rejecting stored key blob of %d bytes (expected %d)",
                 (int)priv_len, DEVICE_KEY_PRIV_LEN);
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = device_key_crypto_init();
    if (err != ESP_OK) {
        return err;
    }

    device_key_unload();

    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    device_key_attributes(&attr);

    psa_status_t st = psa_import_key(&attr, priv, priv_len, &s_key_id);
    psa_reset_key_attributes(&attr);
    if (st != PSA_SUCCESS) {
        ESP_LOGE(TAG, "psa_import_key failed: %d", (int)st);
        s_key_id = PSA_KEY_ID_NULL;
        return ESP_FAIL;
    }

    return ESP_OK;
}

esp_err_t device_key_generate(uint8_t *priv_out)
{
    if (priv_out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = device_key_crypto_init();
    if (err != ESP_OK) {
        return err;
    }

    device_key_unload();

    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    device_key_attributes(&attr);

    psa_status_t st = psa_generate_key(&attr, &s_key_id);
    psa_reset_key_attributes(&attr);
    if (st != PSA_SUCCESS) {
        ESP_LOGE(TAG, "psa_generate_key failed: %d", (int)st);
        s_key_id = PSA_KEY_ID_NULL;
        return ESP_FAIL;
    }

    size_t out_len = 0;
    st = psa_export_key(s_key_id, priv_out, DEVICE_KEY_PRIV_LEN, &out_len);
    if (st != PSA_SUCCESS || out_len != DEVICE_KEY_PRIV_LEN) {
        ESP_LOGE(TAG, "psa_export_key failed: %d (len=%d)", (int)st, (int)out_len);
        device_key_unload();
        return ESP_FAIL;
    }

    return ESP_OK;
}

esp_err_t device_key_export_spki(uint8_t *spki_out)
{
    if (spki_out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!device_key_is_loaded()) {
        return ESP_ERR_INVALID_STATE;
    }

    memcpy(spki_out, SPKI_P256_PREFIX, SPKI_PREFIX_LEN);

    size_t point_len = 0;
    psa_status_t st = psa_export_public_key(s_key_id, spki_out + SPKI_PREFIX_LEN,
                                            DEVICE_KEY_POINT_LEN, &point_len);
    if (st != PSA_SUCCESS || point_len != DEVICE_KEY_POINT_LEN) {
        ESP_LOGE(TAG, "psa_export_public_key failed: %d (len=%d)", (int)st, (int)point_len);
        return ESP_FAIL;
    }

    return ESP_OK;
}

esp_err_t device_key_export_pem(char *buf, size_t buf_size)
{
    if (buf == NULL || buf_size < DEVICE_KEY_PEM_MIN_SIZE) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t spki[DEVICE_KEY_SPKI_LEN];
    esp_err_t err = device_key_export_spki(spki);
    if (err != ESP_OK) {
        return err;
    }

    // Base64 of 91 bytes is 124 characters, which PEM wraps at 64 per line.
    char b64[128];
    size_t b64_len = 0;
    int ret = mbedtls_base64_encode((unsigned char *)b64, sizeof(b64), &b64_len,
                                    spki, sizeof(spki));
    if (ret != 0) {
        ESP_LOGE(TAG, "base64 encode failed: -0x%04x", -ret);
        return ESP_FAIL;
    }

    static const char BEGIN[] = "-----BEGIN PUBLIC KEY-----\n";
    static const char END[] = "-----END PUBLIC KEY-----\n";

    size_t pos = 0;
    size_t needed = strlen(BEGIN) + b64_len + (b64_len + 63) / 64 + strlen(END) + 1;
    if (needed > buf_size) {
        return ESP_ERR_INVALID_SIZE;
    }

    memcpy(buf + pos, BEGIN, strlen(BEGIN));
    pos += strlen(BEGIN);

    for (size_t i = 0; i < b64_len; i += 64) {
        size_t chunk = (b64_len - i) < 64 ? (b64_len - i) : 64;
        memcpy(buf + pos, b64 + i, chunk);
        pos += chunk;
        buf[pos++] = '\n';
    }

    memcpy(buf + pos, END, strlen(END));
    pos += strlen(END);
    buf[pos] = '\0';

    return ESP_OK;
}

esp_err_t device_key_sign_hash(const uint8_t *hash32, uint8_t *sig_out)
{
    if (hash32 == NULL || sig_out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!device_key_is_loaded()) {
        return ESP_ERR_INVALID_STATE;
    }

    size_t sig_len = 0;
    psa_status_t st = psa_sign_hash(s_key_id, PSA_ALG_ECDSA(PSA_ALG_SHA_256),
                                    hash32, 32, sig_out, DEVICE_KEY_SIG_LEN, &sig_len);
    if (st != PSA_SUCCESS || sig_len != DEVICE_KEY_SIG_LEN) {
        ESP_LOGE(TAG, "psa_sign_hash failed: %d (len=%d)", (int)st, (int)sig_len);
        return ESP_FAIL;
    }

    return ESP_OK;
}

esp_err_t device_key_ecdh(const uint8_t *peer_spki, size_t peer_spki_len,
                          uint8_t *secret_out)
{
    if (peer_spki == NULL || secret_out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }
    if (!device_key_is_loaded()) {
        return ESP_ERR_INVALID_STATE;
    }

    // Only prime256v1 SPKI is accepted; the point itself is validated by PSA.
    if (peer_spki_len != DEVICE_KEY_SPKI_LEN ||
        memcmp(peer_spki, SPKI_P256_PREFIX, SPKI_PREFIX_LEN) != 0) {
        ESP_LOGE(TAG, "Peer SPKI is not a %d-byte prime256v1 key (len=%d)",
                 DEVICE_KEY_SPKI_LEN, (int)peer_spki_len);
        return ESP_ERR_INVALID_ARG;
    }

    size_t secret_len = 0;
    psa_status_t st = psa_raw_key_agreement(PSA_ALG_ECDH, s_key_id,
                                            peer_spki + SPKI_PREFIX_LEN,
                                            DEVICE_KEY_POINT_LEN,
                                            secret_out, 32, &secret_len);
    if (st != PSA_SUCCESS || secret_len != 32) {
        ESP_LOGE(TAG, "psa_raw_key_agreement failed: %d (len=%d)", (int)st, (int)secret_len);
        return ESP_FAIL;
    }

    return ESP_OK;
}

esp_err_t crypto_sha256(const void *data, size_t len, uint8_t *hash_out)
{
    if (hash_out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = device_key_crypto_init();
    if (err != ESP_OK) {
        return err;
    }

    size_t hash_len = 0;
    psa_status_t st = psa_hash_compute(PSA_ALG_SHA_256, (const uint8_t *)data, len,
                                       hash_out, 32, &hash_len);
    if (st != PSA_SUCCESS || hash_len != 32) {
        ESP_LOGE(TAG, "psa_hash_compute failed: %d", (int)st);
        return ESP_FAIL;
    }

    return ESP_OK;
}

esp_err_t crypto_aes256_gcm_decrypt(const uint8_t *key32, const uint8_t *iv12,
                                    const uint8_t *ct, size_t ct_len,
                                    const uint8_t *tag16, uint8_t *pt_out)
{
    if (key32 == NULL || iv12 == NULL || tag16 == NULL || pt_out == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = device_key_crypto_init();
    if (err != ESP_OK) {
        return err;
    }

    psa_key_attributes_t attr = PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_usage_flags(&attr, PSA_KEY_USAGE_DECRYPT);
    psa_set_key_algorithm(&attr, PSA_ALG_GCM);
    psa_set_key_type(&attr, PSA_KEY_TYPE_AES);
    psa_set_key_bits(&attr, 256);

    psa_key_id_t aes_key = PSA_KEY_ID_NULL;
    psa_status_t st = psa_import_key(&attr, key32, 32, &aes_key);
    psa_reset_key_attributes(&attr);
    if (st != PSA_SUCCESS) {
        ESP_LOGE(TAG, "AES key import failed: %d", (int)st);
        return ESP_FAIL;
    }

    // PSA takes the ciphertext with the authentication tag appended, while the
    // provisioning protocol carries them separately.
    uint8_t *ct_with_tag = malloc(ct_len + 16);
    if (ct_with_tag == NULL) {
        psa_destroy_key(aes_key);
        return ESP_ERR_NO_MEM;
    }
    memcpy(ct_with_tag, ct, ct_len);
    memcpy(ct_with_tag + ct_len, tag16, 16);

    size_t pt_len = 0;
    st = psa_aead_decrypt(aes_key, PSA_ALG_GCM, iv12, 12,
                          NULL, 0,
                          ct_with_tag, ct_len + 16,
                          pt_out, ct_len, &pt_len);

    free(ct_with_tag);
    psa_destroy_key(aes_key);

    if (st != PSA_SUCCESS || pt_len != ct_len) {
        ESP_LOGE(TAG, "psa_aead_decrypt failed: %d", (int)st);
        return ESP_FAIL;
    }

    return ESP_OK;
}
