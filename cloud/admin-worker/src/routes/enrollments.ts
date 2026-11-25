import type { D1Database } from '@cloudflare/workers-types';
import { getAllEnrollments } from '../lib/db.js';

interface Env {
  DB: D1Database;
}

export async function handleListEnrollments(env: Env): Promise<Response> {
  const enrollments = await getAllEnrollments(env.DB);

  return new Response(
    JSON.stringify({
      enrollments: enrollments.map((e) => ({
        enrollment_id: e.enrollment_id,
        serial_number: e.serial_number,
        created_at: e.created_at,
        expires_at: e.expires_at,
      })),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
