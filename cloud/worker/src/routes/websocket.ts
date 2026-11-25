import type { D1Database, KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import { DeviceSerialSchema } from '@molstem/cloud-shared';
import { validateSession, unauthorizedResponse } from '../middleware/session.js';
import { verifyGenericMtlsCert, mtlsForbiddenResponse } from '../middleware/mtls.js';
import { getDeviceBySerial, updateDeviceLastSeen } from '../lib/db.js';
import { parseDeviceAuthHeader, verifyDeviceSignature, checkAndStoreNonce } from '../lib/crypto.js';

export interface WebSocketEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  NONCES: KVNamespace;
  DEVICE_PROXY: DurableObjectNamespace;
}

/**
 * Check if running in development mode (local or workers.dev)
 * In these environments, mTLS is not available so we trust the serial from query param
 */
function isDevMode(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname.endsWith('.workers.dev')
  );
}

/**
 * GET /ws/device - Device WebSocket connection (mTLS + signature required in production)
 *
 * Authentication flow:
 * - Dev mode: Trust serial from query param (no mTLS or signature required)
 * - Production: Generic mTLS cert + per-device signature verification via X-Device-Auth header
 */
export async function handleDeviceWebSocket(
  request: Request,
  env: WebSocketEnv
): Promise<Response> {
  // Validate WebSocket upgrade
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  let deviceSerial: string;

  // In local dev mode, get serial from query param; in production, verify mTLS + signature
  if (isDevMode(request)) {
    const url = new URL(request.url);
    const serial = url.searchParams.get('serial');
    if (!serial) {
      return new Response(
        JSON.stringify({ error: 'missing_serial', message: 'Serial query param required in dev mode' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    deviceSerial = serial;
    console.log(`[WebSocket] Dev mode - using serial from query: ${deviceSerial}`);
  } else {
    // Production: Verify generic mTLS certificate
    if (!verifyGenericMtlsCert(request)) {
      return mtlsForbiddenResponse('Valid device certificate required');
    }

    // Parse and verify device signature from X-Device-Auth header
    const authHeader = request.headers.get('X-Device-Auth');
    const auth = parseDeviceAuthHeader(authHeader);

    if (!auth) {
      return new Response(
        JSON.stringify({ error: 'missing_auth', message: 'X-Device-Auth header required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    deviceSerial = auth.serial;

    // Look up device to get public key
    const existingDevice = await getDeviceBySerial(env.DB, deviceSerial);

    if (!existingDevice?.public_key) {
      return new Response(
        JSON.stringify({ error: 'device_not_registered', message: 'Device must register first with public key' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify signature using the stored public key
    const isValidSignature = await verifyDeviceSignature(auth, existingDevice.public_key);
    if (!isValidSignature) {
      return new Response(
        JSON.stringify({ error: 'invalid_signature', message: 'Signature verification failed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check nonce hasn't been used (replay protection)
    const nonceValid = await checkAndStoreNonce(env.NONCES, deviceSerial, auth.nonce);
    if (!nonceValid) {
      return new Response(
        JSON.stringify({ error: 'nonce_reused', message: 'Nonce has already been used' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Check if device exists in database (for dev mode, already checked above in production)
  const device = await getDeviceBySerial(env.DB, deviceSerial);

  if (!device) {
    // Device hasn't registered yet - this shouldn't happen normally
    // but we handle it gracefully
    console.log(`[WebSocket] Unknown device attempted connection: ${deviceSerial}`);
    return new Response(
      JSON.stringify({ error: 'device_not_registered', message: 'Device must register first' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Update last seen
  await updateDeviceLastSeen(env.DB, deviceSerial);

  // Get the Durable Object for this device
  const doId = env.DEVICE_PROXY.idFromName(deviceSerial);
  const stub = env.DEVICE_PROXY.get(doId);

  // Forward the WebSocket request to the Durable Object
  const doUrl = new URL(request.url);
  doUrl.pathname = '/device';
  doUrl.searchParams.set('serial', deviceSerial);

  return stub.fetch(new Request(doUrl.toString(), {
    method: request.method,
    headers: request.headers,
  }));
}

/**
 * GET /ws/user?device={serial} - User WebSocket connection (session required)
 */
export async function handleUserWebSocket(
  request: Request,
  env: WebSocketEnv
): Promise<Response> {
  // Validate session
  const session = await validateSession(request, env.SESSIONS);

  if (!session) {
    return unauthorizedResponse();
  }

  // Validate WebSocket upgrade
  const upgradeHeader = request.headers.get('Upgrade');
  if (upgradeHeader?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  // Get device serial from query parameter
  const url = new URL(request.url);
  const deviceSerial = url.searchParams.get('device');

  if (!deviceSerial) {
    return new Response(
      JSON.stringify({ error: 'missing_device', message: 'Device serial required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate serial format
  const serialResult = DeviceSerialSchema.safeParse(deviceSerial);
  if (!serialResult.success) {
    return new Response(
      JSON.stringify({ error: 'invalid_device', message: 'Invalid device serial format' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check if device exists and belongs to user
  const device = await getDeviceBySerial(env.DB, deviceSerial);

  if (!device) {
    return new Response(
      JSON.stringify({ error: 'device_not_found', message: 'Device not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (device.user_id !== session.user_id) {
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Device does not belong to you' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get the Durable Object for this device
  const doId = env.DEVICE_PROXY.idFromName(deviceSerial);
  const stub = env.DEVICE_PROXY.get(doId);

  // Forward the WebSocket request to the Durable Object
  const doUrl = new URL(request.url);
  doUrl.pathname = '/user';
  doUrl.searchParams.set('userId', session.user_id);

  return stub.fetch(new Request(doUrl.toString(), {
    method: request.method,
    headers: request.headers,
  }));
}
