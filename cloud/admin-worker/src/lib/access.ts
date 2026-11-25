import { jwtVerify, createRemoteJWKSet } from 'jose';

export interface AccessIdentity {
  email: string;
  name?: string;
  sub: string;
  iat: number;
  exp: number;
}

export interface AccessEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

export type AccessResult =
  | { status: 'valid'; identity: AccessIdentity }
  | { status: 'expired' }  // Token too old, need to re-auth
  | { status: 'invalid' }; // No token or invalid token

/**
 * Validate Cloudflare Access JWT from request headers.
 *
 * When Cloudflare Access is configured in front of admin.molstem.com,
 * it injects a signed JWT in the "Cf-Access-Jwt-Assertion" header.
 * This function validates that JWT against Cloudflare's public keys.
 */
export async function validateAccessJWT(
  request: Request,
  env: AccessEnv
): Promise<AccessResult> {
  // Require Access configuration - deny all requests if not configured
  if (!env.TEAM_DOMAIN || !env.POLICY_AUD) {
    console.log('[Access] TEAM_DOMAIN and POLICY_AUD not configured - access denied');
    return { status: 'invalid' };
  }

  // Get JWT from header (preferred) or cookie
  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    getCookieValue(request.headers.get('Cookie'), 'CF_Authorization');

  if (!token) {
    console.log('[Access] No JWT token found in request');
    return { status: 'invalid' };
  }

  try {
    // Create remote JWKS - Cloudflare rotates keys every 6 weeks
    const JWKS = createRemoteJWKSet(
      new URL(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)
    );

    // Verify JWT
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.TEAM_DOMAIN,
      audience: env.POLICY_AUD,
    });

    // Enforce max token age (Cloudflare issues 24h JWTs, but we want 15min sessions)
    const now = Math.floor(Date.now() / 1000);
    const tokenAge = now - (payload.iat as number);
    const MAX_TOKEN_AGE = 15 * 60; // 15 minutes

    if (tokenAge > MAX_TOKEN_AGE) {
      console.log(`[Access] Token too old (${tokenAge}s > ${MAX_TOKEN_AGE}s), requiring re-auth`);
      return { status: 'expired' };
    }

    return {
      status: 'valid',
      identity: {
        email: payload.email as string,
        name: payload.name as string | undefined,
        sub: payload.sub as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
      },
    };
  } catch (error) {
    console.error('[Access] JWT validation failed:', error);
    return { status: 'invalid' };
  }
}

function getCookieValue(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}
