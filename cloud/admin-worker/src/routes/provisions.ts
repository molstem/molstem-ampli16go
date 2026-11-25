import type { D1Database } from '@cloudflare/workers-types';

interface Env {
  DB: D1Database;
}

interface DbProvision {
  id: number;
  serial_number: string;
  attestation_hash: string;
  provision_mode: string;
  hw_version: string | null;
  provisioned_by: string | null;
  created_at: number;
  signed_off_at: number | null;
}

export async function handleListProvisions(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT id, serial_number, attestation_hash, provision_mode, hw_version, provisioned_by, created_at, signed_off_at
    FROM provisions
    ORDER BY created_at DESC
  `).all<DbProvision>();

  return new Response(
    JSON.stringify({
      provisions: result.results.map((p) => ({
        id: p.id,
        serial_number: p.serial_number,
        attestation_hash: p.attestation_hash,
        provision_mode: p.provision_mode,
        hw_version: p.hw_version,
        provisioned_by: p.provisioned_by,
        created_at: p.created_at,
        signed_off_at: p.signed_off_at,
      })),
    }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
