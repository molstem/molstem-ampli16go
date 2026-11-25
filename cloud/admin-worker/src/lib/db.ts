import type { D1Database } from '@cloudflare/workers-types';

/**
 * Get current Unix timestamp in seconds
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * User record from database
 */
export interface DbUser {
  id: string;
  email: string;
  google_id: string;
  name: string | null;
  picture_url: string | null;
  created_at: number;
  last_login_at: number | null;
}

/**
 * Device record from database
 */
export interface DbDevice {
  serial_number: string;
  user_id: string | null;
  name: string | null;
  cert_fingerprint: string | null;
  public_key: string | null;
  enrolled_at: number | null;
  last_seen_at: number | null;
  created_at: number;
}

/**
 * Enrollment record from database
 */
export interface DbEnrollment {
  enrollment_id: string;
  serial_number: string;
  created_at: number;
  expires_at: number;
}

// ============================================================================
// Device Operations
// ============================================================================

export async function getDeviceBySerial(
  db: D1Database,
  serialNumber: string
): Promise<DbDevice | null> {
  const result = await db
    .prepare('SELECT * FROM devices WHERE serial_number = ?')
    .bind(serialNumber)
    .first<DbDevice>();
  return result;
}

export async function createDeviceWithPublicKey(
  db: D1Database,
  serialNumber: string,
  publicKey: string,
  certFingerprint: string | null
): Promise<DbDevice> {
  const createdAt = now();

  await db
    .prepare(
      'INSERT INTO devices (serial_number, public_key, cert_fingerprint, created_at) VALUES (?, ?, ?, ?)'
    )
    .bind(serialNumber, publicKey, certFingerprint, createdAt)
    .run();

  return {
    serial_number: serialNumber,
    user_id: null,
    name: null,
    cert_fingerprint: certFingerprint,
    public_key: publicKey,
    enrolled_at: null,
    last_seen_at: null,
    created_at: createdAt,
  };
}

export async function setDeviceName(
  db: D1Database,
  serialNumber: string,
  name: string
): Promise<void> {
  await db
    .prepare('UPDATE devices SET name = ? WHERE serial_number = ?')
    .bind(name, serialNumber)
    .run();
}

// ============================================================================
// Admin Operations
// ============================================================================

export async function getAllDevices(db: D1Database): Promise<DbDevice[]> {
  const result = await db
    .prepare('SELECT * FROM devices ORDER BY created_at DESC')
    .all<DbDevice>();
  return result.results;
}

export async function getAllUsers(db: D1Database): Promise<DbUser[]> {
  const result = await db
    .prepare('SELECT * FROM users ORDER BY created_at DESC')
    .all<DbUser>();
  return result.results;
}

export async function getAllEnrollments(db: D1Database): Promise<DbEnrollment[]> {
  const result = await db
    .prepare('SELECT * FROM enrollments ORDER BY created_at DESC')
    .all<DbEnrollment>();
  return result.results;
}
