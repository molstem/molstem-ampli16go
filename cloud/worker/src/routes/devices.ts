import type { D1Database, KVNamespace, DurableObjectNamespace } from '@cloudflare/workers-types';
import {
  DeviceRegisterRequestSchema,
  type DeviceRegisterResponse,
  type DeviceListResponse,
  type RemoveDeviceResponse,
} from '@molstem/cloud-shared';
import {
  getDeviceBySerial,
  getDevicesByUserId,
  createDevice,
  createDeviceWithPublicKey,
  updateDevicePublicKey,
  unenrollDevice,
  createEnrollment,
  updateDeviceLastSeen,
} from '../lib/db.js';
import { validateSession, unauthorizedResponse } from '../middleware/session.js';
import { verifyGenericMtlsCert, getCertFingerprint, mtlsForbiddenResponse } from '../middleware/mtls.js';
import { parseDeviceAuthHeader, verifyDeviceSignature, checkAndStoreNonce } from '../lib/crypto.js';

export interface DevicesEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  NONCES: KVNamespace;
  DEVICE_PROXY: DurableObjectNamespace;
}

/**
 * Check if running in development mode (local or workers.dev)
 * In these environments, mTLS is not available so we trust the serial from request body
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
 * POST /device/api/register - Device registers itself
 *
 * Authentication flow:
 * - Dev mode: Trust serial from request body (no mTLS or signature required)
 * - Production: Generic mTLS cert + per-device signature verification
 *
 * This endpoint is called by devices to get an enrollment ID
 */
export async function handleDeviceRegister(request: Request, env: DevicesEnv): Promise<Response> {
  // Parse and validate request body first
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parseResult = DeviceRegisterRequestSchema.safeParse(body);
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

  const { serial_number, public_key } = parseResult.data;
  let certFingerprint: string | null = null;

  if (isDevMode(request)) {
    // Dev mode: skip mTLS and signature verification
    console.log('[Devices] Dev mode - skipping mTLS and signature verification');
  } else {
    // Production: Verify generic mTLS certificate
    if (!verifyGenericMtlsCert(request)) {
      return mtlsForbiddenResponse('Valid device certificate required');
    }
    certFingerprint = getCertFingerprint(request);

    // Parse and verify device signature from X-Device-Auth header
    const authHeader = request.headers.get('X-Device-Auth');
    const auth = parseDeviceAuthHeader(authHeader);

    if (!auth) {
      return new Response(
        JSON.stringify({ error: 'missing_auth', message: 'X-Device-Auth header required' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify serial in auth matches request body
    if (auth.serial !== serial_number) {
      return new Response(
        JSON.stringify({ error: 'serial_mismatch', message: 'Serial in auth header does not match request' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing device (may be pre-provisioned via admin)
    const existingDevice = await getDeviceBySerial(env.DB, serial_number);

    let devicePublicKey: string | null = null;

    if (existingDevice?.public_key) {
      // Device was pre-provisioned or has registered before - use stored key
      devicePublicKey = existingDevice.public_key;
    } else if (public_key) {
      // First registration with public key in request body
      devicePublicKey = public_key;
    } else {
      return new Response(
        JSON.stringify({ error: 'missing_public_key', message: 'Public key required for first registration' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Verify signature using the public key
    const isValidSignature = await verifyDeviceSignature(auth, devicePublicKey);
    if (!isValidSignature) {
      return new Response(
        JSON.stringify({ error: 'invalid_signature', message: 'Signature verification failed' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check nonce hasn't been used (replay protection)
    const nonceValid = await checkAndStoreNonce(env.NONCES, serial_number, auth.nonce);
    if (!nonceValid) {
      return new Response(
        JSON.stringify({ error: 'nonce_reused', message: 'Nonce has already been used' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // Check if device already exists
  let device = await getDeviceBySerial(env.DB, serial_number);

  if (!device) {
    // Create new device record with public key
    if (public_key) {
      device = await createDeviceWithPublicKey(env.DB, serial_number, public_key, certFingerprint);
    } else {
      device = await createDevice(env.DB, serial_number, certFingerprint);
    }
    console.log(`[Devices] Created new device: ${serial_number}`);
  } else {
    // Update last seen, and potentially update public key if first time providing
    await updateDeviceLastSeen(env.DB, serial_number);
    if (public_key && !device.public_key) {
      await updateDevicePublicKey(env.DB, serial_number, public_key);
      console.log(`[Devices] Updated public key for device: ${serial_number}`);
    }
  }

  // An enrolled device needs no code; tell it so and drop any stale code.
  if (device.user_id !== null) {
    await env.DB.prepare('DELETE FROM enrollments WHERE serial_number = ?').bind(serial_number).run();
    const enrolledResponse: DeviceRegisterResponse = {
      enrolled: true,
      enrollment_id: null,
      expires_at: null,
    };
    return new Response(JSON.stringify(enrolledResponse), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Create enrollment record
  const enrollment = await createEnrollment(env.DB, serial_number);

  const response: DeviceRegisterResponse = {
    enrolled: false,
    enrollment_id: enrollment.enrollment_id,
    expires_at: enrollment.expires_at,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * GET /api/devices - List user's enrolled devices (session required)
 */
export async function handleListDevices(request: Request, env: DevicesEnv): Promise<Response> {
  const session = await validateSession(request, env.SESSIONS);

  if (!session) {
    return unauthorizedResponse();
  }

  const devices = await getDevicesByUserId(env.DB, session.user_id);

  // Check device online status from Durable Objects in parallel
  const deviceStatuses = await Promise.all(
    devices.map(async (d) => {
      try {
        const doId = env.DEVICE_PROXY.idFromName(d.serial_number);
        const stub = env.DEVICE_PROXY.get(doId);
        const statusRes = await stub.fetch(new Request('https://do/status'));
        if (statusRes.ok) {
          const status = await statusRes.json() as { deviceConnected: boolean };
          return { serial: d.serial_number, online: status.deviceConnected };
        }
      } catch {
        // Ignore errors, assume offline
      }
      return { serial: d.serial_number, online: false };
    })
  );

  const onlineMap = new Map(deviceStatuses.map((s) => [s.serial, s.online]));

  const response: DeviceListResponse = {
    devices: devices.map((d) => ({
      serial_number: d.serial_number,
      name: d.name || `Device ${d.serial_number.slice(-8)}`,
      enrolled_at: d.enrolled_at || 0,
      last_seen_at: d.last_seen_at,
      online: onlineMap.get(d.serial_number) ?? false,
    })),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * DELETE /api/devices/{serial} - Remove device from user's account (session required)
 */
export async function handleRemoveDevice(
  request: Request,
  env: DevicesEnv,
  serial: string
): Promise<Response> {
  const session = await validateSession(request, env.SESSIONS);

  if (!session) {
    return unauthorizedResponse();
  }

  // Check if device exists and belongs to user
  const device = await getDeviceBySerial(env.DB, serial);

  if (!device) {
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'Device not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (device.user_id !== session.user_id) {
    return new Response(
      JSON.stringify({ error: 'forbidden', message: 'Device does not belong to you' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Unenroll device
  await unenrollDevice(env.DB, serial);
  console.log(`[Devices] Unenrolled device ${serial} from user ${session.user_id}`);

  // Ask a connected device to register again so a fresh enrollment code shows up
  // on its screen without a reboot (best effort; the device also re-registers at boot).
  try {
    const doId = env.DEVICE_PROXY.idFromName(serial);
    const stub = env.DEVICE_PROXY.get(doId);
    await stub.fetch('https://device-proxy/notify-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'reregister' }),
    });
  } catch (error) {
    console.warn(`[Devices] Could not notify device ${serial} to re-register:`, error);
  }

  const response: RemoveDeviceResponse = { success: true };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
