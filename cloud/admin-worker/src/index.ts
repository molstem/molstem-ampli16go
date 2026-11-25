import type { D1Database } from '@cloudflare/workers-types';
import { validateAccessJWT } from './lib/access.js';
import { handleListDevices, handleProvisionDevice } from './routes/devices.js';
import { handleListUsers } from './routes/users.js';
import { handleListEnrollments } from './routes/enrollments.js';
import { handleListProvisions } from './routes/provisions.js';
import {
  handlePrepareKeyExchange,
  handleVerifyAttestation,
  handleGenerateSignoff,
} from './routes/provision.js';

export interface Env {
  DB: D1Database;
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
  // Provisioning secrets
  MTLS_CERT?: string;
  MTLS_KEY?: string;
  PA_PRIVATE_KEY?: string;
  PA_PUBLIC_KEY?: string;
  // Static assets
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // Validate Cloudflare Access JWT for all requests
  const authResult = await validateAccessJWT(request, env);

  if (authResult.status === 'expired') {
    // Session expired - redirect to logout to clear stale cookie and re-authenticate
    return Response.redirect(new URL('/cdn-cgi/access/logout', url.origin).toString(), 302);
  }

  if (authResult.status === 'invalid') {
    return new Response('Unauthorized - Cloudflare Access required', {
      status: 401,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  const identity = authResult.identity;

  // API Routes (must be checked before static assets)
  if (path.startsWith('/api/')) {
    const apiPath = path.slice(4); // Remove '/api' prefix

    // Device routes
    if (apiPath === '/devices' && method === 'GET') {
      return handleListDevices(env);
    }
    if (apiPath === '/devices' && method === 'POST') {
      return handleProvisionDevice(request, env);
    }

    // User routes
    if (apiPath === '/users' && method === 'GET') {
      return handleListUsers(env);
    }

    // Enrollment routes
    if (apiPath === '/enrollments' && method === 'GET') {
      return handleListEnrollments(env);
    }

    // Provisions routes
    if (apiPath === '/provisions' && method === 'GET') {
      return handleListProvisions(env);
    }

    // Provisioning routes
    if (apiPath === '/provision/prepare-key-exchange' && method === 'POST') {
      return handlePrepareKeyExchange(request, env as Parameters<typeof handlePrepareKeyExchange>[1], identity);
    }
    if (apiPath === '/provision/verify-attestation' && method === 'POST') {
      return handleVerifyAttestation(request, env as Parameters<typeof handleVerifyAttestation>[1], identity);
    }
    if (apiPath === '/provision/generate-signoff' && method === 'POST') {
      return handleGenerateSignoff(request, env as Parameters<typeof handleGenerateSignoff>[1], identity);
    }

    return new Response(
      JSON.stringify({ error: 'not_found', message: 'API endpoint not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Serve static assets for the React SPA
  if (env.ASSETS) {
    // For SPA routing, serve index.html for non-asset paths
    const response = await env.ASSETS.fetch(request);
    if (response.status === 404) {
      // Try serving index.html for client-side routing
      const indexRequest = new Request(new URL('/', url.origin), request);
      return env.ASSETS.fetch(indexRequest);
    }
    return response;
  }

  // Fallback if no static assets configured (dev mode)
  return new Response('Static assets not configured. Run frontend build first.', {
    status: 500,
    headers: { 'Content-Type': 'text/plain' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('[Admin Worker] Error:', error);
      return new Response(
        JSON.stringify({
          error: 'internal_error',
          message: 'An internal error occurred',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
