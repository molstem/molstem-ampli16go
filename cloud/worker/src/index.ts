import type { D1Database, KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';

// Route handlers
import {
  handleGoogleAuth,
  handleGoogleCallback,
  handleLogout,
  handleAuthMe,
} from './routes/auth.js';
import {
  handleDeviceRegister,
  handleListDevices,
  handleRemoveDevice,
} from './routes/devices.js';
import {
  handleGetEnrollment,
  handleClaimEnrollment,
} from './routes/enrollment.js';
import {
  handleDeviceWebSocket,
  handleUserWebSocket,
} from './routes/websocket.js';

// Re-export Durable Object class
export { DeviceProxy } from './durable-objects/device-proxy.js';

export interface Env {
  // Secrets
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;

  // Variables
  APP_DOMAIN: string;     // e.g. app.molstem.com (web UI + user/cloud API)
  DEVICE_DOMAIN: string;  // e.g. devices.molstem.com (mTLS device endpoints)

  // Static web UI assets (webui/dist)
  ASSETS: Fetcher;

  // KV Namespaces
  SESSIONS: KVNamespace;
  OAUTH_STATE: KVNamespace;
  NONCES: KVNamespace;  // For device signature nonce replay protection

  // D1 Database
  DB: D1Database;

  // Durable Objects
  DEVICE_PROXY: DurableObjectNamespace;
}

/**
 * True when the request arrived on the device hostname (mTLS-protected) or a local dev host.
 */
function isDeviceHost(url: URL, env: Env): boolean {
  const host = url.hostname;
  return host === env.DEVICE_DOMAIN || host === 'localhost' || host === '127.0.0.1';
}

function notFound(): Response {
  return new Response(
    JSON.stringify({ error: 'not_found', message: 'Endpoint not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * CORS headers for API responses
 */
function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Handle CORS preflight requests
 */
function handleOptions(request: Request): Response {
  const origin = request.headers.get('Origin');
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

/**
 * Add CORS headers to response
 */
function addCorsHeaders(response: Response, origin: string | null): Response {
  const newHeaders = new Headers(response.headers);
  const cors = corsHeaders(origin);
  for (const [key, value] of Object.entries(cors)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/**
 * Main request handler
 */
async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;
  const origin = request.headers.get('Origin');

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return handleOptions(request);
  }

  let response: Response;

  try {
    // Route matching
    // Auth routes
    if (path === '/auth/google' && method === 'GET') {
      response = await handleGoogleAuth(request, env);
    } else if (path === '/auth/google/callback' && method === 'GET') {
      response = await handleGoogleCallback(request, env);
    } else if (path === '/auth/logout' && method === 'POST') {
      response = await handleLogout(request, env);
    } else if (path === '/auth/me' && method === 'GET') {
      response = await handleAuthMe(request, env);
    }

    // Device routes (devices.molstem.com/v0/...)
    else if (path === '/v0/register' && method === 'POST') {
      if (!isDeviceHost(url, env)) {
        return notFound();
      }
      response = await handleDeviceRegister(request, env);
    }
    // Device WebSocket
    else if (path === '/v0/ws' && method === 'GET') {
      // Check hostname to differentiate device vs client WebSocket
      if (isDeviceHost(url, env)) {
        response = await handleDeviceWebSocket(request, env);
      } else {
        response = await handleUserWebSocket(request, env);
      }
    }

    // Client API routes (app.molstem.com/v0/...)
    else if (path === '/v0/devices' && method === 'GET') {
      response = await handleListDevices(request, env);
    } else if (path.startsWith('/v0/devices/') && method === 'DELETE') {
      const serial = path.replace('/v0/devices/', '');
      response = await handleRemoveDevice(request, env, serial);
    }

    // Enrollment routes (app.molstem.com/v0/...)
    else if (path.startsWith('/v0/enrollment/') && method === 'GET') {
      const enrollmentId = path.replace('/v0/enrollment/', '');
      response = await handleGetEnrollment(request, env, enrollmentId);
    } else if (path.startsWith('/v0/enrollment/') && method === 'POST') {
      const enrollmentId = path.replace('/v0/enrollment/', '');
      response = await handleClaimEnrollment(request, env, enrollmentId);
    }

    // mTLS diagnostics: echoes what Cloudflare reports about the client certificate (no secrets)
    else if (path === '/v0/tls' && method === 'GET') {
      const cf = (request.cf as { tlsClientAuth?: Record<string, string>; tlsVersion?: string } | undefined);
      response = new Response(
        JSON.stringify({
          host: url.hostname,
          isDeviceHost: isDeviceHost(url, env),
          tlsVersion: cf?.tlsVersion ?? null,
          clientCert: cf?.tlsClientAuth ?? null,
        }, null, 2),
        { headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Health check
    else if (path === '/health' && method === 'GET') {
      response = new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Unknown API paths -> JSON 404
    else if (path.startsWith('/v0/') || path.startsWith('/auth/')) {
      response = notFound();
    }

    // Everything else: static web UI (webui/dist). Unknown paths such as /devices
    // fall back to index.html (single-page-application mode) so the SPA can route them.
    else {
      return env.ASSETS.fetch(request);
    }
  } catch (error) {
    console.error('[Worker] Unhandled error:', error);
    response = new Response(
      JSON.stringify({
        error: 'internal_error',
        message: error instanceof Error ? error.message : 'Internal server error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Add CORS headers to non-redirect responses
  if (response.status !== 302 && response.status !== 101) {
    return addCorsHeaders(response, origin);
  }

  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    console.log(`[Worker] ${request.method} ${url.pathname} - Upgrade: ${request.headers.get('Upgrade')}`);
    return handleRequest(request, env, ctx);
  },
};
