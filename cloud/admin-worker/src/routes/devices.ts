import type { D1Database } from '@cloudflare/workers-types';
import { AdminProvisionDeviceRequestSchema } from '@molstem/cloud-shared';
import {
  getAllDevices,
  getDeviceBySerial,
  createDeviceWithPublicKey,
  setDeviceName,
} from '../lib/db.js';

interface Env {
  DB: D1Database;
}

export async function handleListDevices(env: Env): Promise<Response> {
  const devices = await getAllDevices(env.DB);

  return new Response(
    JSON.stringify({
      devices: devices.map((d) => ({
        serial_number: d.serial_number,
        public_key: d.public_key,
        user_id: d.user_id,
        name: d.name,
        enrolled_at: d.enrolled_at,
        last_seen_at: d.last_seen_at,
        created_at: d.created_at,
      })),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export async function handleProvisionDevice(
  request: Request,
  env: Env
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'invalid_request', message: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const parseResult = AdminProvisionDeviceRequestSchema.safeParse(body);
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

  const { serial_number, public_key, name } = parseResult.data;

  const existing = await getDeviceBySerial(env.DB, serial_number);
  if (existing) {
    return new Response(
      JSON.stringify({ error: 'device_exists', message: 'Device already exists' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const device = await createDeviceWithPublicKey(env.DB, serial_number, public_key, null);

  if (name) {
    await setDeviceName(env.DB, serial_number, name);
  }

  return new Response(
    JSON.stringify({
      success: true,
      device: {
        serial_number: device.serial_number,
        public_key: public_key,
        name: name || null,
        created_at: device.created_at,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
