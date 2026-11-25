import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';

export interface CertificateConfig {
  certPath: string;
  keyPath: string;
}

export interface CertificateData {
  cert: string;
  key: string;
}

export interface DeviceKeyPair {
  publicKey: string;  // Base64-encoded SPKI
  privateKey: crypto.KeyObject;
}

export interface DeviceAuthHeader {
  serial: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

/**
 * Load certificate and private key from files
 */
export function loadCertificates(config: CertificateConfig): CertificateData {
  const cert = fs.readFileSync(config.certPath, 'utf-8');
  const key = fs.readFileSync(config.keyPath, 'utf-8');
  return { cert, key };
}

/**
 * Create an HTTPS agent configured with client certificates for mTLS
 */
export function createMtlsAgent(certs: CertificateData): https.Agent {
  return new https.Agent({
    cert: certs.cert,
    key: certs.key,
    rejectUnauthorized: true, // Verify server certificate
  });
}

/**
 * Generate a self-signed certificate for local development/testing.
 * In production, certificates should be issued by Cloudflare's CA.
 *
 * This is a placeholder - actual implementation would use node-forge
 * or call out to openssl.
 */
export async function generateSelfSignedCert(
  serial: string,
  outputDir: string
): Promise<CertificateConfig> {
  const certPath = path.join(outputDir, `${serial}.crt`);
  const keyPath = path.join(outputDir, `${serial}.key`);

  // Check if openssl is available
  const { execSync } = await import('child_process');

  try {
    // Generate private key
    execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });

    // Generate self-signed certificate with serial as CN
    const subject = `/CN=${serial}/O=molstem/OU=Device`;
    execSync(
      `openssl req -new -x509 -key "${keyPath}" -out "${certPath}" -days 3650 -subj "${subject}"`,
      { stdio: 'pipe' }
    );

    console.log(`[Certificate] Generated self-signed cert for ${serial}`);
    console.log(`  Certificate: ${certPath}`);
    console.log(`  Private key: ${keyPath}`);

    return { certPath, keyPath };
  } catch (error) {
    throw new Error(
      `Failed to generate certificate. Ensure openssl is installed and in PATH.\n${error}`
    );
  }
}

/**
 * Extract device serial from certificate's Common Name (CN)
 */
export function extractSerialFromCert(cert: string): string | null {
  // Simple regex to extract CN from certificate subject
  // In production, use proper x509 parsing
  const match = cert.match(/CN\s*=\s*(MOLSTEM-[0-9A-HJKMNP-TV-Z]{26})/i);
  return match ? match[1] : null;
}

/**
 * Validate that certificate CN matches expected serial
 */
export function validateCertSerial(cert: string, expectedSerial: string): boolean {
  const certSerial = extractSerialFromCert(cert);
  return certSerial === expectedSerial;
}

// ============================================================================
// Device Signing (ECC P-256) - Per-device key authentication
// ============================================================================

/**
 * Generate a new ECC P-256 keypair for device authentication
 */
export function generateDeviceKeypair(): DeviceKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',  // P-256
  });

  // Export public key as SPKI in base64
  const publicKeySpki = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyBase64 = publicKeySpki.toString('base64');

  return {
    publicKey: publicKeyBase64,
    privateKey,
  };
}

/**
 * Load device keypair from PEM files
 */
export function loadDeviceKeypair(publicKeyPath: string, privateKeyPath: string): DeviceKeyPair {
  const publicKeyPem = fs.readFileSync(publicKeyPath, 'utf-8');
  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf-8');

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(publicKeyPem);

  // Export public key as SPKI in base64
  const publicKeySpki = publicKey.export({ type: 'spki', format: 'der' });
  const publicKeyBase64 = publicKeySpki.toString('base64');

  return {
    publicKey: publicKeyBase64,
    privateKey,
  };
}

/**
 * Save device keypair to PEM files
 */
export function saveDeviceKeypair(
  keypair: DeviceKeyPair,
  publicKeyPath: string,
  privateKeyPath: string
): void {
  // We need to derive the public key from private for PEM export
  const publicKey = crypto.createPublicKey(keypair.privateKey);

  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = keypair.privateKey.export({ type: 'pkcs8', format: 'pem' });

  fs.writeFileSync(publicKeyPath, publicKeyPem as string);
  fs.writeFileSync(privateKeyPath, privateKeyPem as string);
}

/**
 * Create signature message for device authentication
 * Format: "{serial}:{timestamp}:{nonce}"
 */
function createSignatureMessage(serial: string, timestamp: number, nonce: string): string {
  return `${serial}:${timestamp}:${nonce}`;
}

/**
 * Convert DER-encoded ECDSA signature to IEEE P1363 format (r || s)
 * Web Crypto API expects P1363 format, but Node.js crypto produces DER
 */
function derToP1363(derSignature: Buffer, keySize: number = 32): Buffer {
  // DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
  let offset = 0;

  // Skip sequence tag and length
  if (derSignature[offset++] !== 0x30) {
    throw new Error('Invalid DER signature: expected sequence tag');
  }
  // Skip length byte(s)
  if (derSignature[offset] & 0x80) {
    offset += (derSignature[offset] & 0x7f) + 1;
  } else {
    offset++;
  }

  // Read r
  if (derSignature[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: expected integer tag for r');
  }
  const rLength = derSignature[offset++];
  let rStart = offset;
  offset += rLength;

  // Read s
  if (derSignature[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: expected integer tag for s');
  }
  const sLength = derSignature[offset++];
  let sStart = offset;

  // Extract r and s, removing leading zeros if present
  let r = derSignature.subarray(rStart, rStart + rLength);
  let s = derSignature.subarray(sStart, sStart + sLength);

  // Remove leading zero padding (DER uses it for positive numbers with high bit set)
  if (r.length > keySize && r[0] === 0) {
    r = r.subarray(1);
  }
  if (s.length > keySize && s[0] === 0) {
    s = s.subarray(1);
  }

  // Pad to keySize if shorter
  const result = Buffer.alloc(keySize * 2);
  r.copy(result, keySize - r.length);
  s.copy(result, keySize * 2 - s.length);

  return result;
}

/**
 * Sign a message using device's private key (ECDSA with SHA-256)
 * Returns signature in IEEE P1363 format (r || s) for Web Crypto API compatibility
 */
function signMessage(message: string, privateKey: crypto.KeyObject): string {
  const sign = crypto.createSign('SHA256');
  sign.update(message);
  sign.end();
  // Node.js produces DER-encoded signature
  const derSignature = sign.sign(privateKey);
  // Convert to P1363 format for Web Crypto API compatibility
  const p1363Signature = derToP1363(derSignature, 32); // P-256 uses 32-byte values
  return p1363Signature.toString('base64');
}

/**
 * Create X-Device-Auth header for authenticating requests
 * Returns the header value (base64-encoded JSON payload)
 */
export function createDeviceAuthHeader(serial: string, privateKey: crypto.KeyObject): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString('hex');  // 32 hex chars

  const message = createSignatureMessage(serial, timestamp, nonce);
  const signature = signMessage(message, privateKey);

  const payload: DeviceAuthHeader = {
    serial,
    timestamp,
    nonce,
    signature,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
