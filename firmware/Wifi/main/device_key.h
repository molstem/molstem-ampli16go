// Device identity key (NIST P-256) and the crypto primitives built on it.
//
// Backed by the PSA Crypto API. ESP-IDF v6.0 moved to Mbed TLS 4.x, where the
// legacy mbedtls_pk / mbedtls_ecdh / mbedtls_gcm / mbedtls_sha256 APIs no
// longer exist, so everything the provisioning and cloud paths need is
// funnelled through this module.
//
// Key material on the wire and in NVS:
//   - NVS blob        : the raw 32-byte private scalar
//   - Public key      : SubjectPublicKeyInfo DER (91 bytes for prime256v1),
//                       byte-identical to what mbedtls_pk_write_pubkey_der
//                       produced, so derived device serials stay stable
//   - Signatures      : IEEE P1363 (r || s, 64 bytes), which is what PSA
//                       returns natively - no DER conversion step any more
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define DEVICE_KEY_PRIV_LEN      32   // P-256 private scalar
#define DEVICE_KEY_POINT_LEN     65   // uncompressed point: 0x04 || X || Y
#define DEVICE_KEY_SPKI_LEN      91   // SubjectPublicKeyInfo DER, prime256v1
#define DEVICE_KEY_SIG_LEN       64   // ECDSA P-256 signature, r || s
#define DEVICE_KEY_PEM_MIN_SIZE 200   // enough for the PEM of a P-256 SPKI

// Initialize PSA Crypto. Safe to call repeatedly.
esp_err_t device_key_crypto_init(void);

// True once a private key has been imported or generated.
bool device_key_is_loaded(void);

// Import an existing private key. Expects DEVICE_KEY_PRIV_LEN raw scalar bytes;
// any other length is rejected (which is how a key blob written by an older,
// DER-based firmware gets discarded and regenerated).
esp_err_t device_key_import(const uint8_t *priv, size_t priv_len);

// Generate a fresh P-256 key and export the private scalar for storage.
// priv_out must have room for DEVICE_KEY_PRIV_LEN bytes.
esp_err_t device_key_generate(uint8_t *priv_out);

// Drop the loaded key.
void device_key_unload(void);

// Public key as SubjectPublicKeyInfo DER (DEVICE_KEY_SPKI_LEN bytes).
esp_err_t device_key_export_spki(uint8_t *spki_out);

// Public key as PEM ("-----BEGIN PUBLIC KEY-----" ...), NUL-terminated.
esp_err_t device_key_export_pem(char *buf, size_t buf_size);

// ECDSA-sign a precomputed SHA-256 digest. sig_out gets DEVICE_KEY_SIG_LEN bytes.
esp_err_t device_key_sign_hash(const uint8_t *hash32, uint8_t *sig_out);

// ECDH against a peer public key in SubjectPublicKeyInfo DER form.
// secret_out gets the 32-byte shared X coordinate.
esp_err_t device_key_ecdh(const uint8_t *peer_spki, size_t peer_spki_len,
                          uint8_t *secret_out);

// SHA-256, replacing mbedtls_sha256().
esp_err_t crypto_sha256(const void *data, size_t len, uint8_t *hash_out);

// AES-256-GCM decrypt with a detached tag, replacing mbedtls_gcm_auth_decrypt().
// pt_out must have room for ct_len bytes.
esp_err_t crypto_aes256_gcm_decrypt(const uint8_t *key32, const uint8_t *iv12,
                                    const uint8_t *ct, size_t ct_len,
                                    const uint8_t *tag16, uint8_t *pt_out);
