import type { D1Database } from '@cloudflare/workers-types';
import {
  PrepareKeyExchangeRequestSchema,
  VerifyAttestationRequestSchema,
  GenerateSignoffRequestSchema,
  AttestationDataSchema,
} from '@molstem/cloud-shared';
import { getDeviceBySerial, createDeviceWithPublicKey, now } from '../lib/db.js';
import type { AccessIdentity } from '../lib/access.js';

interface Env {
  DB: D1Database;
  // Secrets for mTLS and PA signing
  MTLS_CERT: string;        // mTLS certificate PEM
  MTLS_KEY: string;         // mTLS private key PEM
  PA_PRIVATE_KEY: string;   // Provisioning Authority private key PEM
  PA_PUBLIC_KEY: string;    // Provisioning Authority public key PEM
}

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Import a PEM public key for ECDH
 */
async function importEcdhPublicKey(pem: string): Promise<CryptoKey> {
  // Remove PEM headers and decode base64
  // Handle both "-----BEGIN PUBLIC KEY-----" format and raw base64
  let pemContents = pem.trim();

  // Remove PEM headers if present
  if (pemContents.includes('-----BEGIN')) {
    pemContents = pemContents
      .replace(/-----BEGIN [A-Z ]+-----/g, '')
      .replace(/-----END [A-Z ]+-----/g, '')
      .replace(/\s/g, '');
  } else {
    // Already raw base64, just remove whitespace
    pemContents = pemContents.replace(/\s/g, '');
  }

  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'spki',
    binaryDer,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

/**
 * Generate an ephemeral ECDH key pair
 */
async function generateEphemeralKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  ) as Promise<CryptoKeyPair>;
}

/**
 * Export a public key to SPKI format (base64)
 */
async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported as ArrayBuffer)));
}

/**
 * Perform ECDH key agreement and derive AES key
 */
async function deriveAesKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  // ECDH to get shared secret
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey } as any,
    privateKey,
    256
  );

  // Use SHA-256 of shared secret as AES key
  const aesKeyBytes = await crypto.subtle.digest('SHA-256', sharedBits);

  return crypto.subtle.importKey('raw', aesKeyBytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt data with AES-GCM
 */
async function encryptAesGcm(
  key: CryptoKey,
  plaintext: Uint8Array
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    plaintext
  );

  // AES-GCM appends auth tag to ciphertext
  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertext = encryptedBytes.slice(0, -16);
  const authTag = encryptedBytes.slice(-16);

  return { ciphertext, iv, authTag };
}

/**
 * Import PA private key for signing
 */
async function importPaPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN EC PRIVATE KEY-----/, '')
    .replace(/-----END EC PRIVATE KEY-----/, '')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

/**
 * Sign data with ECDSA-SHA256
 */
async function signEcdsa(key: CryptoKey, data: Uint8Array): Promise<string> {
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    data
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Compute SHA-256 hash
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bufferToHex(hashBuffer);
}

/**
 * Import device public key for signature verification
 */
async function importDevicePublicKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  return crypto.subtle.importKey(
    'spki',
    binaryDer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

/**
 * Verify ECDSA signature
 */
async function verifyEcdsa(
  key: CryptoKey,
  signature: Uint8Array,
  data: Uint8Array
): Promise<boolean> {
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    signature,
    data
  );
}

// =============================================================================
// Route Handlers
// =============================================================================

/**
 * POST /api/provision/prepare-key-exchange
 *
 * Receives device info and returns encrypted mTLS credentials
 */
export async function handlePrepareKeyExchange(
  request: Request,
  env: Env,
  _identity: AccessIdentity
): Promise<Response> {
  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parseResult = PrepareKeyExchangeRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return new Response(
      JSON.stringify({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parseResult.error.flatten(),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { serial, publicKey, wifiMac, chipId, nonce } = parseResult.data;

  // Check if secrets are configured
  if (!env.MTLS_CERT || !env.MTLS_KEY || !env.PA_PUBLIC_KEY) {
    return new Response(
      JSON.stringify({
        error: 'configuration_error',
        message: 'Server secrets not configured',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Import device's public key for ECDH
    const devicePubKey = await importEcdhPublicKey(publicKey);

    // Generate ephemeral key pair for this exchange
    const ephemeralKeyPair = await generateEphemeralKeyPair();

    // Derive shared AES key
    const aesKey = await deriveAesKey(ephemeralKeyPair.privateKey, devicePubKey);

    // Encrypt the mTLS private key
    const mtlsKeyBytes = new TextEncoder().encode(env.MTLS_KEY);
    const { ciphertext, iv, authTag } = await encryptAesGcm(aesKey, mtlsKeyBytes);

    // Export ephemeral public key
    const ephemeralPubKeyB64 = await exportPublicKey(ephemeralKeyPair.publicKey);

    // Build the payload for the device
    const payload = {
      mtlsCert: env.MTLS_CERT,
      encryptedKey: btoa(String.fromCharCode(...ciphertext)),
      ephemeralPubKey: ephemeralPubKeyB64,
      iv: btoa(String.fromCharCode(...iv)),
      authTag: btoa(String.fromCharCode(...authTag)),
      paPubKey: env.PA_PUBLIC_KEY,
    };

    // Base64 encode the entire payload
    const payloadB64 = btoa(JSON.stringify(payload));

    // Store device info in DB (or update if exists)
    const existing = await getDeviceBySerial(env.DB, serial);
    if (!existing) {
      // Extract base64 part of public key for storage
      const pubKeyB64 = publicKey
        .replace(/-----BEGIN PUBLIC KEY-----/, '')
        .replace(/-----END PUBLIC KEY-----/, '')
        .replace(/\s/g, '');
      await createDeviceWithPublicKey(env.DB, serial, pubKeyB64, null);
    }

    // Store the exchange metadata (nonce, wifiMac, chipId) for later verification
    // For now, we'll include it in attestation verification
    console.log(`[Provision] Key exchange prepared for ${serial}, MAC: ${wifiMac}, Chip: ${chipId}, Nonce: ${nonce}`);

    return new Response(JSON.stringify({ payload: payloadB64 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Provision] Key exchange error:', error);
    return new Response(
      JSON.stringify({
        error: 'crypto_error',
        message: 'Failed to prepare key exchange',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/provision/verify-attestation
 *
 * Verifies device attestation signature and returns parsed data
 */
export async function handleVerifyAttestation(
  request: Request,
  env: Env,
  _identity: AccessIdentity
): Promise<Response> {
  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parseResult = VerifyAttestationRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return new Response(
      JSON.stringify({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parseResult.error.flatten(),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { attestation } = parseResult.data;

  try {
    // Decode the attestation
    const attestationJson = atob(attestation);
    const attestationObj = JSON.parse(attestationJson);

    // Extract data (base64-encoded JSON string) and signature
    const { data: dataB64, signature } = attestationObj;
    if (!dataB64 || !signature) {
      return new Response(
        JSON.stringify({
          error: 'invalid_attestation',
          message: 'Attestation must contain data and signature',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Decode the base64 data to get the original JSON string (preserves exact formatting)
    const dataJsonString = atob(dataB64);
    const data = JSON.parse(dataJsonString);

    // Parse and validate attestation data
    const dataParseResult = AttestationDataSchema.safeParse(data);
    if (!dataParseResult.success) {
      console.error('[Provision] Attestation data validation failed:', JSON.stringify(dataParseResult.error.flatten()));
      console.error('[Provision] Received data:', JSON.stringify(data));
      return new Response(
        JSON.stringify({
          error: 'invalid_attestation',
          message: 'Invalid attestation data format',
          details: dataParseResult.error.flatten(),
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const attestationData = dataParseResult.data;

    // Verify signature using device's public key
    // Use the original JSON string bytes (not re-serialized) to match what the device signed
    const devicePubKey = await importDevicePublicKey(attestationData.publicKey);
    const dataBytes = new TextEncoder().encode(dataJsonString);
    const signatureBytes = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0));

    const isValid = await verifyEcdsa(devicePubKey, signatureBytes, dataBytes);
    if (!isValid) {
      return new Response(
        JSON.stringify({
          error: 'invalid_signature',
          message: 'Attestation signature verification failed',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Compute attestation hash for signoff (use original string to preserve exact bytes)
    const attestationHash = await sha256(dataJsonString);

    // Update device record with provisioning data
    await env.DB.prepare(`
      UPDATE devices SET
        public_key = ?,
        name = ?
      WHERE serial_number = ?
    `).bind(
      attestationData.publicKey
        .replace(/-----BEGIN PUBLIC KEY-----/, '')
        .replace(/-----END PUBLIC KEY-----/, '')
        .replace(/\s/g, ''),
      `${attestationData.hwVersion}`,
      attestationData.serial
    ).run();

    // Store attestation in provisions table
    await env.DB.prepare(`
      INSERT INTO provisions (serial_number, attestation_json, attestation_hash, provision_mode, hw_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      attestationData.serial,
      attestation, // Store the original base64 attestation
      attestationHash,
      attestationData.provisionMode,
      attestationData.hwVersion,
      Math.floor(Date.now() / 1000)
    ).run();

    return new Response(
      JSON.stringify({
        valid: true,
        serial: attestationData.serial,
        publicKey: attestationData.publicKey,
        calibration: attestationData.calibration,
        hwVersion: attestationData.hwVersion,
        hwComment: attestationData.hwComment,
        provisionMode: attestationData.provisionMode,
        attestationHash,
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[Provision] Attestation verification error:', error);
    return new Response(
      JSON.stringify({
        error: 'verification_error',
        message: 'Failed to verify attestation',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

/**
 * POST /api/provision/generate-signoff
 *
 * Generates signed approval for device
 */
export async function handleGenerateSignoff(
  request: Request,
  env: Env,
  identity: AccessIdentity
): Promise<Response> {
  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parseResult = GenerateSignoffRequestSchema.safeParse(body);
  if (!parseResult.success) {
    return new Response(
      JSON.stringify({
        error: 'validation_error',
        message: 'Invalid request body',
        details: parseResult.error.flatten(),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { attestationHash, serial } = parseResult.data;

  // Check if PA key is configured
  if (!env.PA_PRIVATE_KEY) {
    return new Response(
      JSON.stringify({
        error: 'configuration_error',
        message: 'PA signing key not configured',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Build signoff data
    const signoffData = {
      userName: identity.email,
      date: new Date().toISOString(),
      attestationHash,
    };

    // Sign the signoff data
    const paPrivateKey = await importPaPrivateKey(env.PA_PRIVATE_KEY);
    const dataBytes = new TextEncoder().encode(JSON.stringify(signoffData));
    const signature = await signEcdsa(paPrivateKey, dataBytes);

    // Build the complete signoff payload
    const signoffPayload = {
      ...signoffData,
      signature,
    };

    // Base64 encode
    const payloadB64 = btoa(JSON.stringify(signoffPayload));

    // Update device as provisioned
    await env.DB.prepare(`
      UPDATE devices SET
        enrolled_at = ?
      WHERE serial_number = ?
    `).bind(now(), serial).run();

    // Update provisions table with signoff
    await env.DB.prepare(`
      UPDATE provisions SET
        signoff_json = ?,
        provisioned_by = ?,
        signed_off_at = ?
      WHERE attestation_hash = ? AND serial_number = ?
    `).bind(
      payloadB64,
      identity.email,
      now(),
      attestationHash,
      serial
    ).run();

    console.log(`[Provision] Signoff generated for ${serial} by ${identity.email}`);

    return new Response(JSON.stringify({ payload: payloadB64 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Provision] Signoff generation error:', error);
    return new Response(
      JSON.stringify({
        error: 'signing_error',
        message: 'Failed to generate signoff',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
