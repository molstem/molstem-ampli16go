import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import {
  GoogleTokenResponseSchema,
  GoogleUserInfoSchema,
  type AuthMeResponse,
} from '@molstem/cloud-shared';
import {
  generateSessionId,
  setSession,
  deleteSession,
  getSessionIdFromCookie,
  createSessionCookie,
  createClearSessionCookie,
  generateOAuthState,
  setOAuthState,
  getOAuthState,
} from '../lib/kv.js';
import {
  getUserByGoogleId,
  createUser,
  updateUserLastLogin,
  getUserById,
} from '../lib/db.js';
import { validateSession, unauthorizedResponse } from '../middleware/session.js';

export interface AuthEnv {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  APP_DOMAIN: string;
  SESSIONS: KVNamespace;
  OAUTH_STATE: KVNamespace;
  DB: D1Database;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * Get the base URL from request (handles proxied requests via X-Forwarded-* headers)
 */
function getBaseUrl(request: Request): string {
  // Check for forwarded headers (from Vite proxy or other reverse proxies)
  const forwardedHost = request.headers.get('X-Forwarded-Host');
  const forwardedProto = request.headers.get('X-Forwarded-Proto');

  if (forwardedHost) {
    // For localhost, always use http (Google OAuth allows http for localhost)
    const isLocalhost = forwardedHost === 'localhost' || forwardedHost.startsWith('localhost:') ||
                        forwardedHost === '127.0.0.1' || forwardedHost.startsWith('127.0.0.1:');
    const protocol = isLocalhost ? 'http' : (forwardedProto || 'https');
    return `${protocol}://${forwardedHost}`;
  }

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * GET /auth/google - Initiate Google OAuth flow
 */
export async function handleGoogleAuth(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const redirectAfterLogin = url.searchParams.get('redirect') || '/';

  // Generate state for CSRF protection
  const state = generateOAuthState();

  // Generate nonce for additional security
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Store state in KV
  await setOAuthState(env.OAUTH_STATE, state, {
    nonce,
    redirect_uri: redirectAfterLogin,
  });

  // Build authorization URL - use request host for local dev compatibility
  const baseUrl = getBaseUrl(request);
  const redirectUri = `${baseUrl}/auth/google/callback`;
  console.log('[Auth] Redirect URI:', redirectUri);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    access_type: 'online',
    prompt: 'select_account',
  });

  const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

  return Response.redirect(authUrl, 302);
}

/**
 * GET /auth/google/callback - Handle OAuth callback
 */
export async function handleGoogleCallback(request: Request, env: AuthEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Handle OAuth errors
  if (error) {
    console.error('[Auth] OAuth error:', error);
    return new Response(`Authentication failed: ${error}`, { status: 400 });
  }

  // Validate required parameters
  if (!code || !state) {
    return new Response('Missing code or state parameter', { status: 400 });
  }

  // Validate state (CSRF protection)
  const oauthState = await getOAuthState(env.OAUTH_STATE, state);
  if (!oauthState) {
    return new Response('Invalid or expired state', { status: 400 });
  }

  // Exchange code for tokens - use request host for local dev compatibility
  const baseUrl = getBaseUrl(request);
  const redirectUri = `${baseUrl}/auth/google/callback`;

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('[Auth] Token exchange failed:', errorText);
    return new Response('Failed to exchange code for token', { status: 500 });
  }

  const tokenData = await tokenResponse.json();
  const tokenResult = GoogleTokenResponseSchema.safeParse(tokenData);

  if (!tokenResult.success) {
    console.error('[Auth] Invalid token response:', tokenResult.error);
    return new Response('Invalid token response from Google', { status: 500 });
  }

  // Get user info from Google
  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${tokenResult.data.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    console.error('[Auth] Failed to get user info');
    return new Response('Failed to get user info from Google', { status: 500 });
  }

  const userInfoData = await userInfoResponse.json();
  const userInfoResult = GoogleUserInfoSchema.safeParse(userInfoData);

  if (!userInfoResult.success) {
    console.error('[Auth] Invalid user info response:', userInfoResult.error);
    return new Response('Invalid user info response from Google', { status: 500 });
  }

  const googleUser = userInfoResult.data;

  // Find or create user in database
  let user = await getUserByGoogleId(env.DB, googleUser.id);

  if (!user) {
    // Create new user
    user = await createUser(
      env.DB,
      googleUser.id,
      googleUser.email,
      googleUser.name || null,
      googleUser.picture || null
    );
    console.log(`[Auth] Created new user: ${user.email}`);
  } else {
    // Update last login
    await updateUserLastLogin(env.DB, user.id);
    console.log(`[Auth] User logged in: ${user.email}`);
  }

  // Create session
  const sessionId = generateSessionId();
  await setSession(env.SESSIONS, sessionId, {
    user_id: user.id,
    email: user.email,
    name: user.name,
  });

  // Redirect to original destination or home
  const redirectTo = oauthState.redirect_uri || '/';
  const finalRedirect = `${baseUrl}${redirectTo}`;

  // Disable Secure flag for localhost (dev mode)
  // Check both actual hostname and forwarded host
  const forwardedHost = request.headers.get('X-Forwarded-Host');
  const effectiveHost = forwardedHost || url.hostname;
  const isLocalhost = effectiveHost === 'localhost' || effectiveHost.startsWith('localhost:') || effectiveHost === '127.0.0.1' || effectiveHost.startsWith('127.0.0.1:');

  return new Response(null, {
    status: 302,
    headers: {
      Location: finalRedirect,
      'Set-Cookie': createSessionCookie(sessionId, !isLocalhost),
    },
  });
}

/**
 * POST /auth/logout - Clear session
 */
export async function handleLogout(request: Request, env: AuthEnv): Promise<Response> {
  const cookieHeader = request.headers.get('Cookie');
  const sessionId = getSessionIdFromCookie(cookieHeader);

  if (sessionId) {
    await deleteSession(env.SESSIONS, sessionId);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': createClearSessionCookie(),
    },
  });
}

/**
 * GET /auth/me - Get current user info
 */
export async function handleAuthMe(request: Request, env: AuthEnv): Promise<Response> {
  const session = await validateSession(request, env.SESSIONS);

  if (!session) {
    return unauthorizedResponse();
  }

  const user = await getUserById(env.DB, session.user_id);

  if (!user) {
    // Session exists but user doesn't - clear invalid session
    const cookieHeader = request.headers.get('Cookie');
    const sessionId = getSessionIdFromCookie(cookieHeader);
    if (sessionId) {
      await deleteSession(env.SESSIONS, sessionId);
    }
    return unauthorizedResponse('User not found');
  }

  const response: AuthMeResponse = {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture_url: user.picture_url,
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
