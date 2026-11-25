import type { KVNamespace } from '@cloudflare/workers-types';
import { getSession, getSessionIdFromCookie } from '../lib/kv.js';
import type { SessionData } from '@molstem/cloud-shared';

export interface AuthenticatedRequest extends Request {
  session: SessionData;
}

/**
 * Validate session from request cookies
 * Returns session data if valid, null otherwise
 */
export async function validateSession(
  request: Request,
  sessionsKv: KVNamespace
): Promise<SessionData | null> {
  const cookieHeader = request.headers.get('Cookie');
  const sessionId = getSessionIdFromCookie(cookieHeader);

  if (!sessionId) {
    return null;
  }

  return getSession(sessionsKv, sessionId);
}

/**
 * Create a 401 Unauthorized response
 */
export function unauthorizedResponse(message: string = 'Unauthorized'): Response {
  return new Response(
    JSON.stringify({
      error: 'unauthorized',
      message,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
}

/**
 * Middleware wrapper that requires authentication
 * Calls handler with session data if authenticated, returns 401 otherwise
 */
export function requireAuth<Env>(
  handler: (
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    session: SessionData
  ) => Promise<Response>
): (request: Request, env: Env, ctx: ExecutionContext, sessionsKv: KVNamespace) => Promise<Response> {
  return async (request, env, ctx, sessionsKv) => {
    const session = await validateSession(request, sessionsKv);

    if (!session) {
      return unauthorizedResponse();
    }

    return handler(request, env, ctx, session);
  };
}
