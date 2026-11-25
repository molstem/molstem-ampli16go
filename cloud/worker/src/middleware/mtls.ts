/**
 * mTLS middleware for device authentication
 *
 * Cloudflare provides client certificate info via cf.tlsClientAuth on the request.
 * The WAF rule should block requests without valid certs, but we double-check here.
 *
 * With generic mTLS mode, all devices share a single certificate with CN="MOLSTEM-THERMOCYCLER-0".
 * Device identity is verified via per-device public key signing (see lib/crypto.ts).
 */

// Generic certificate CN that all devices use
const GENERIC_DEVICE_CN = 'MOLSTEM-THERMOCYCLER-0';

export interface TlsClientAuth {
  certIssuerDN: string;
  certIssuerDNRFC2253: string;
  certIssuerDNLegacy: string;
  certSubjectDN: string;
  certSubjectDNRFC2253: string;
  certSubjectDNLegacy: string;
  certVerified: string; // "SUCCESS" or "FAILED:reason"
  certFingerprintSHA1: string;
  certFingerprintSHA256: string;
  certNotBefore: string;
  certNotAfter: string;
  certSerial: string;
  certPresented: string; // "0" or "1"
}

export interface CfRequestInit {
  tlsClientAuth?: TlsClientAuth;
}

/**
 * Verify that request has valid generic mTLS certificate.
 * All devices share the same certificate with CN="MOLSTEM-THERMOCYCLER-0".
 * Device identity is verified separately via per-device public key signing.
 *
 * @returns true if certificate is valid and has correct generic CN
 */
export function verifyGenericMtlsCert(request: Request): boolean {
  const cf = request.cf as CfRequestInit | undefined;

  if (!cf?.tlsClientAuth) {
    console.log('[mTLS] No client certificate present');
    return false;
  }

  const certInfo = cf.tlsClientAuth;

  // Check if certificate was verified
  if (certInfo.certVerified !== 'SUCCESS') {
    console.log(`[mTLS] Certificate verification failed: ${certInfo.certVerified}`);
    return false;
  }

  // Check if certificate was presented
  if (certInfo.certPresented !== '1') {
    console.log('[mTLS] No certificate presented');
    return false;
  }

  // Extract CN from subject DN
  const cnMatch = certInfo.certSubjectDN?.match(/CN=([^,]+)/i);
  if (!cnMatch) {
    console.log(`[mTLS] No CN in certificate subject: ${certInfo.certSubjectDN}`);
    return false;
  }

  const cn = cnMatch[1].trim();

  // Verify CN matches the generic device certificate
  if (cn !== GENERIC_DEVICE_CN) {
    console.log(`[mTLS] Invalid CN: ${cn}, expected ${GENERIC_DEVICE_CN}`);
    return false;
  }

  return true;
}

/**
 * Extract device serial from certificate CN (legacy per-device cert mode)
 * Returns null if certificate is not valid or CN doesn't match expected format
 * @deprecated Use verifyGenericMtlsCert + per-device signing instead
 */
export function getDeviceSerialFromCert(request: Request): string | null {
  const cf = request.cf as CfRequestInit | undefined;

  if (!cf?.tlsClientAuth) {
    console.log('[mTLS] No client certificate present');
    return null;
  }

  const certInfo = cf.tlsClientAuth;

  // Check if certificate was verified
  if (certInfo.certVerified !== 'SUCCESS') {
    console.log(`[mTLS] Certificate verification failed: ${certInfo.certVerified}`);
    return null;
  }

  // Check if certificate was presented
  if (certInfo.certPresented !== '1') {
    console.log('[mTLS] No certificate presented');
    return null;
  }

  // Extract CN from subject DN
  // Format: "CN=MOLSTEM-ABCDEF...,O=molstem,OU=Device"
  const cnMatch = certInfo.certSubjectDN?.match(/CN=([^,]+)/i);
  if (!cnMatch) {
    console.log(`[mTLS] No CN in certificate subject: ${certInfo.certSubjectDN}`);
    return null;
  }

  const cn = cnMatch[1].trim();

  // Validate serial format: MOLSTEM-{26 Crockford base32 characters}
  const serialRegex = /^MOLSTEM-[0-9A-HJKMNP-TV-Z]{26}$/;
  if (!serialRegex.test(cn)) {
    console.log(`[mTLS] Invalid serial format in CN: ${cn}`);
    return null;
  }

  return cn;
}

/**
 * Get certificate fingerprint (SHA256)
 */
export function getCertFingerprint(request: Request): string | null {
  const cf = request.cf as CfRequestInit | undefined;
  return cf?.tlsClientAuth?.certFingerprintSHA256 || null;
}

/**
 * Create a 403 Forbidden response for mTLS errors
 */
export function mtlsForbiddenResponse(message: string = 'Valid client certificate required'): Response {
  return new Response(
    JSON.stringify({
      error: 'forbidden',
      message,
    }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Middleware wrapper that requires valid mTLS certificate
 */
export function requireMtls<Env>(
  handler: (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    deviceSerial: string,
    certFingerprint: string | null
  ) => Promise<Response>
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  return async (request, env, ctx) => {
    const deviceSerial = getDeviceSerialFromCert(request);

    if (!deviceSerial) {
      return mtlsForbiddenResponse();
    }

    const certFingerprint = getCertFingerprint(request);

    return handler(request, env, ctx, deviceSerial, certFingerprint);
  };
}
