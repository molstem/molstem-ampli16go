import type { KVNamespace } from '@cloudflare/workers-types';
import {
  SessionDataSchema,
  OAuthStateSchema,
  type SessionData,
  type OAuthState,
} from '@molstem/cloud-shared';

// Session TTL: 7 days in seconds
const SESSION_TTL = 7 * 24 * 60 * 60;

// OAuth state TTL: 10 minutes in seconds
const OAUTH_STATE_TTL = 10 * 60;

// ============================================================================
// Session Operations
// ============================================================================

/**
 * Generate a secure session ID
 */
export function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get session data by session ID
 */
export async function getSession(
  kv: KVNamespace,
  sessionId: string
): Promise<SessionData | null> {
  const data = await kv.get(`session:${sessionId}`, 'json');
  if (!data) return null;

  const result = SessionDataSchema.safeParse(data);
  if (!result.success) return null;

  // Check if expired
  if (result.data.expires_at < Math.floor(Date.now() / 1000)) {
    // Delete expired session
    await kv.delete(`session:${sessionId}`);
    return null;
  }

  return result.data;
}

/**
 * Create or update a session
 */
export async function setSession(
  kv: KVNamespace,
  sessionId: string,
  data: Omit<SessionData, 'expires_at'>
): Promise<SessionData> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL;

  const session: SessionData = {
    ...data,
    expires_at: expiresAt,
  };

  await kv.put(`session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });

  return session;
}

/**
 * Delete a session
 */
export async function deleteSession(kv: KVNamespace, sessionId: string): Promise<void> {
  await kv.delete(`session:${sessionId}`);
}

/**
 * Extract session ID from cookie header
 */
export function getSessionIdFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const match = cookieHeader.match(/session=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Create Set-Cookie header for session
 */
export function createSessionCookie(sessionId: string, secure: boolean = true): string {
  const parts = [
    `session=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',  // Lax allows WebSocket connections while still protecting against CSRF
    `Max-Age=${SESSION_TTL}`,
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

/**
 * Create Set-Cookie header to clear session
 */
export function createClearSessionCookie(): string {
  return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

// ============================================================================
// OAuth State Operations
// ============================================================================

/**
 * Generate a secure OAuth state token
 */
export function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Store OAuth state for CSRF protection
 */
export async function setOAuthState(
  kv: KVNamespace,
  state: string,
  data: Omit<OAuthState, 'created_at'>
): Promise<void> {
  const oauthState: OAuthState = {
    ...data,
    created_at: Math.floor(Date.now() / 1000),
  };

  await kv.put(`oauth:${state}`, JSON.stringify(oauthState), {
    expirationTtl: OAUTH_STATE_TTL,
  });
}

/**
 * Get and validate OAuth state
 */
export async function getOAuthState(
  kv: KVNamespace,
  state: string
): Promise<OAuthState | null> {
  const data = await kv.get(`oauth:${state}`, 'json');
  if (!data) return null;

  const result = OAuthStateSchema.safeParse(data);
  if (!result.success) return null;

  // Delete state after retrieval (one-time use)
  await kv.delete(`oauth:${state}`);

  return result.data;
}
