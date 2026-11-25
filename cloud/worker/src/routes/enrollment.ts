import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import {
  ClaimEnrollmentRequestSchema,
  type EnrollmentStatusResponse,
  type ClaimEnrollmentResponse,
} from '@molstem/cloud-shared';
import {
  getEnrollmentById,
  getDeviceBySerial,
  enrollDevice,
  claimEnrollment,
} from '../lib/db.js';
import { validateSession, unauthorizedResponse } from '../middleware/session.js';

export interface EnrollmentEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
}

/**
 * GET /api/enrollment/{id} - Check enrollment status (session required)
 */
export async function handleGetEnrollment(
  request: Request,
  env: EnrollmentEnv,
  enrollmentId: string
): Promise<Response> {
  const session = await validateSession(request, env.SESSIONS);

  if (!session) {
    return unauthorizedResponse();
  }

  const enrollment = await getEnrollmentById(env.DB, enrollmentId);

  if (!enrollment) {
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'Enrollment not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check if expired
  const now = Math.floor(Date.now() / 1000);
  if (enrollment.expires_at < now) {
    return new Response(
      JSON.stringify({ error: 'expired', message: 'Enrollment has expired' }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Get device info
  const device = await getDeviceBySerial(env.DB, enrollment.serial_number);

  const response: EnrollmentStatusResponse = {
    enrollment_id: enrollment.enrollment_id,
    serial_number: enrollment.serial_number,
    created_at: enrollment.created_at,
    expires_at: enrollment.expires_at,
    claimed: false, // If enrollment exists, it hasn't been claimed yet (claimed enrollments are deleted)
    device_name: device?.name || null,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/enrollment/{id} - Claim enrollment (session required)
 */
export async function handleClaimEnrollment(
  request: Request,
  env: EnrollmentEnv,
  enrollmentId: string
): Promise<Response> {
  const session = await validateSession(request, env.SESSIONS);

  if (!session) {
    return unauthorizedResponse();
  }

  // Parse and validate request body (optional)
  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) {
      body = JSON.parse(text);
    }
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parseResult = ClaimEnrollmentRequestSchema.safeParse(body);
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

  const { name } = parseResult.data;

  // Look the code up first so a rejected claim does not burn it for the real owner
  const pending = await getEnrollmentById(env.DB, enrollmentId);
  if (!pending) {
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'Enrollment not found or expired' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const owner = await getDeviceBySerial(env.DB, pending.serial_number);
  if (owner && owner.user_id !== null && owner.user_id !== session.user_id) {
    return new Response(
      JSON.stringify({ error: 'already_enrolled', message: 'Device is already enrolled to another user' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Atomically claim the enrollment (delete it if it exists and hasn't expired)
  // This prevents race conditions where two users try to claim the same code
  const enrollment = await claimEnrollment(env.DB, enrollmentId);

  if (!enrollment) {
    return new Response(
      JSON.stringify({ error: 'not_found', message: 'Enrollment not found or expired' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check if device exists
  const device = await getDeviceBySerial(env.DB, enrollment.serial_number);

  if (!device) {
    return new Response(
      JSON.stringify({ error: 'device_not_found', message: 'Device not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check if device is already enrolled to another user
  if (device.user_id !== null && device.user_id !== session.user_id) {
    return new Response(
      JSON.stringify({ error: 'already_enrolled', message: 'Device is already enrolled to another user' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Enroll device to user
  const deviceName = name || `Device ${enrollment.serial_number.slice(-8)}`;
  await enrollDevice(env.DB, enrollment.serial_number, session.user_id, deviceName);

  const now = Math.floor(Date.now() / 1000);

  console.log(`[Enrollment] User ${session.user_id} claimed device ${enrollment.serial_number}`);

  const response: ClaimEnrollmentResponse = {
    success: true,
    device: {
      serial_number: enrollment.serial_number,
      name: deviceName,
      enrolled_at: now,
    },
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
