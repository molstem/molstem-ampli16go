import type { D1Database } from '@cloudflare/workers-types';
import { getAllUsers } from '../lib/db.js';

interface Env {
  DB: D1Database;
}

export async function handleListUsers(env: Env): Promise<Response> {
  const users = await getAllUsers(env.DB);

  return new Response(
    JSON.stringify({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        picture_url: u.picture_url,
        created_at: u.created_at,
        last_login_at: u.last_login_at,
      })),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
