import type { KVNamespace } from '@cloudflare/workers-types';
import { DeviceAuthHeaderSchema, type DeviceAuthHeader } from '@molstem/cloud-shared';

// Signature validity window (5 minutes to account for clock skew)
const SIGNATURE_VALIDITY_SECONDS = 300;

// Nonce cache TTL (must be longer than validity window to prevent replay)
const NONCE_TTL_SECONDS = 600;

/**
 * Parse and validate device authentication header.
 * Header format: X-Device-Auth: base64(JSON({serial, timestamp, nonce, signature}))
 *
 * @param headerValue - The raw X-Device-Auth header value
 * @returns Parsed DeviceAuthHeader or null if invalid
 */
export function parseDeviceAuthHeader(headerValue: string | null): DeviceAuthHeader | null {
  if (!headerValue) return null;

  try {
    const decoded = atob(headerValue);
    const parsed = JSON.parse(decoded);
    const result = DeviceAuthHeaderSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Create the message that was signed by the device.
 * Format: "{serial}:{timestamp}:{nonce}"
 *
 * @param serial - Device serial number
 * @param timestamp - Unix timestamp in seconds
 * @param nonce - Random nonce (32 hex chars)
 * @returns The message string to verify
 */
export function createSignatureMessage(serial: string, timestamp: number, nonce: string): string {
  return `${serial}:${timestamp}:${nonce}`;
}

/**
 * Verify device signature using stored public key.
 * Uses ECDSA with P-256 curve and SHA-256 hash.
 *
 * @param auth - The parsed device auth header
 * @param publicKeyBase64 - Base64-encoded SPKI public key
 * @returns true if signature is valid, false otherwise
 */
export async function verifyDeviceSignature(
  auth: DeviceAuthHeader,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    // Check timestamp is within validity window
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - auth.timestamp) > SIGNATURE_VALIDITY_SECONDS) {
      console.log(`[Crypto] Timestamp outside validity window: ${auth.timestamp} vs ${now} (diff: ${Math.abs(now - auth.timestamp)}s)`);
      return false;
    }

    // Import the public key from base64-encoded SPKI format
    const publicKeyDer = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    const publicKey = await crypto.subtle.importKey(
      'spki',
      publicKeyDer,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    // Create the message that was signed
    const message = createSignatureMessage(auth.serial, auth.timestamp, auth.nonce);
    const messageBytes = new TextEncoder().encode(message);

    // Decode the signature from base64
    const signatureBytes = Uint8Array.from(atob(auth.signature), c => c.charCodeAt(0));

    // Verify the signature using ECDSA with SHA-256
    const isValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signatureBytes,
      messageBytes
    );

    if (!isValid) {
      console.log(`[Crypto] Signature verification failed for ${auth.serial}`);
    }

    return isValid;
  } catch (error) {
    console.error('[Crypto] Signature verification error:', error);
    return false;
  }
}

/**
 * Check if nonce has been used recently (replay protection).
 * Uses KV store for distributed nonce tracking with automatic TTL expiration.
 *
 * @param kv - KV namespace for storing nonces
 * @param serial - Device serial number
 * @param nonce - The nonce to check
 * @returns true if nonce is fresh and was stored, false if replay detected
 */
export async function checkAndStoreNonce(
  kv: KVNamespace,
  serial: string,
  nonce: string
): Promise<boolean> {
  const key = `nonce:${serial}:${nonce}`;

  // Check if nonce exists (was already used)
  const existing = await kv.get(key);
  if (existing !== null) {
    console.log(`[Crypto] Nonce replay detected for ${serial}: ${nonce}`);
    return false;
  }

  // Store nonce with TTL (auto-expires after NONCE_TTL_SECONDS)
  await kv.put(key, '1', { expirationTtl: NONCE_TTL_SECONDS });

  return true;
}

/**
 * Create a device auth header for signing (used by simulator).
 *
 * @param serial - Device serial number
 * @param privateKey - CryptoKey for signing
 * @returns Base64-encoded auth header value
 */
export async function createDeviceAuthHeader(
  serial: string,
  privateKey: CryptoKey
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);

  // Generate random nonce (16 bytes = 32 hex chars)
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Create message and sign it
  const message = createSignatureMessage(serial, timestamp, nonce);
  const messageBytes = new TextEncoder().encode(message);

  const signatureBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    messageBytes
  );

  // Convert signature to base64
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  // Create the auth header payload
  const payload: DeviceAuthHeader = {
    serial,
    timestamp,
    nonce,
    signature,
  };

  // Base64 encode the JSON
  return btoa(JSON.stringify(payload));
}

/**
 * Generate an ECC P-256 keypair for device authentication.
 *
 * @returns Object with privateKey (CryptoKey) and publicKeyBase64 (string)
 */
export async function generateDeviceKeypair(): Promise<{
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyBase64: string;
}> {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  ) as CryptoKeyPair;

  // Export public key as SPKI and encode as base64
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keypair.publicKey) as ArrayBuffer;
  const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)));

  return {
    privateKey: keypair.privateKey,
    publicKey: keypair.publicKey,
    publicKeyBase64,
  };
}

/**
 * Export a private key to PEM format (for saving to file).
 *
 * @param privateKey - The CryptoKey to export
 * @returns PEM-formatted private key string
 */
export async function exportPrivateKeyPem(privateKey: CryptoKey): Promise<string> {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey) as ArrayBuffer;
  const base64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));

  // Format as PEM with 64-char line wrapping
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Export a public key to PEM format (for saving to file).
 *
 * @param publicKey - The CryptoKey to export
 * @returns PEM-formatted public key string
 */
export async function exportPublicKeyPem(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey) as ArrayBuffer;
  const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));

  // Format as PEM with 64-char line wrapping
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

/**
 * Import a private key from PEM format.
 *
 * @param pem - PEM-formatted private key string
 * @returns CryptoKey for signing
 */
export async function importPrivateKeyPem(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and whitespace
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const pkcs8 = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
}

/**
 * Import a public key from PEM format.
 *
 * @param pem - PEM-formatted public key string
 * @returns CryptoKey for verification
 */
export async function importPublicKeyPem(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and whitespace
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');

  const spki = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}
