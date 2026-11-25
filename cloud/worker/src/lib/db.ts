import type { D1Database } from '@cloudflare/workers-types';

/**
 * Get current Unix timestamp in seconds
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Generate a UUID v4
 */
export function uuid(): string {
  return crypto.randomUUID();
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
  public_key: string | null;  // Base64-encoded SPKI public key (P-256)
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
// User Operations
// ============================================================================

export async function getUserById(db: D1Database, id: string): Promise<DbUser | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<DbUser>();
  return result;
}

export async function getUserByGoogleId(db: D1Database, googleId: string): Promise<DbUser | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE google_id = ?')
    .bind(googleId)
    .first<DbUser>();
  return result;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<DbUser | null> {
  const result = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<DbUser>();
  return result;
}

export async function createUser(
  db: D1Database,
  googleId: string,
  email: string,
  name: string | null,
  pictureUrl: string | null
): Promise<DbUser> {
  const id = uuid();
  const createdAt = now();

  await db
    .prepare(
      'INSERT INTO users (id, google_id, email, name, picture_url, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, googleId, email, name, pictureUrl, createdAt)
    .run();

  return {
    id,
    google_id: googleId,
    email,
    name,
    picture_url: pictureUrl,
    created_at: createdAt,
    last_login_at: null,
  };
}

export async function updateUserLastLogin(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(now(), id)
    .run();
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

export async function getDevicesByUserId(db: D1Database, userId: string): Promise<DbDevice[]> {
  const result = await db
    .prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY enrolled_at DESC')
    .bind(userId)
    .all<DbDevice>();
  return result.results;
}

export async function createDevice(
  db: D1Database,
  serialNumber: string,
  certFingerprint: string | null
): Promise<DbDevice> {
  const createdAt = now();

  await db
    .prepare(
      'INSERT INTO devices (serial_number, cert_fingerprint, created_at) VALUES (?, ?, ?)'
    )
    .bind(serialNumber, certFingerprint, createdAt)
    .run();

  return {
    serial_number: serialNumber,
    user_id: null,
    name: null,
    cert_fingerprint: certFingerprint,
    public_key: null,
    enrolled_at: null,
    last_seen_at: null,
    created_at: createdAt,
  };
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

export async function updateDevicePublicKey(
  db: D1Database,
  serialNumber: string,
  publicKey: string
): Promise<void> {
  await db
    .prepare('UPDATE devices SET public_key = ? WHERE serial_number = ?')
    .bind(publicKey, serialNumber)
    .run();
}

export async function enrollDevice(
  db: D1Database,
  serialNumber: string,
  userId: string,
  name: string | null
): Promise<void> {
  const enrolledAt = now();
  const deviceName = name || `Device ${serialNumber.slice(-8)}`;

  await db
    .prepare('UPDATE devices SET user_id = ?, name = ?, enrolled_at = ? WHERE serial_number = ?')
    .bind(userId, deviceName, enrolledAt, serialNumber)
    .run();
}

export async function unenrollDevice(db: D1Database, serialNumber: string): Promise<void> {
  await db
    .prepare('UPDATE devices SET user_id = NULL, name = NULL, enrolled_at = NULL WHERE serial_number = ?')
    .bind(serialNumber)
    .run();
}

export async function updateDeviceLastSeen(db: D1Database, serialNumber: string): Promise<void> {
  await db
    .prepare('UPDATE devices SET last_seen_at = ? WHERE serial_number = ?')
    .bind(now(), serialNumber)
    .run();
}

// ============================================================================
// Enrollment Operations
// ============================================================================

export async function getEnrollmentById(
  db: D1Database,
  enrollmentId: string
): Promise<DbEnrollment | null> {
  const result = await db
    .prepare('SELECT * FROM enrollments WHERE enrollment_id = ?')
    .bind(enrollmentId)
    .first<DbEnrollment>();
  return result;
}

export async function getEnrollmentBySerial(
  db: D1Database,
  serialNumber: string
): Promise<DbEnrollment | null> {
  const result = await db
    .prepare('SELECT * FROM enrollments WHERE serial_number = ?')
    .bind(serialNumber)
    .first<DbEnrollment>();
  return result;
}

export async function createEnrollment(
  db: D1Database,
  serialNumber: string
): Promise<DbEnrollment> {
  // Generate enrollment ID from random bytes (format: XXXX-XXXX)
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  const enrollmentId = `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;

  const createdAt = now();
  const expiresAt = createdAt + 5 * 60; // 5 minutes

  // Delete any existing enrollment for this device
  await db
    .prepare('DELETE FROM enrollments WHERE serial_number = ?')
    .bind(serialNumber)
    .run();

  await db
    .prepare(
      'INSERT INTO enrollments (enrollment_id, serial_number, created_at, expires_at) VALUES (?, ?, ?, ?)'
    )
    .bind(enrollmentId, serialNumber, createdAt, expiresAt)
    .run();

  return {
    enrollment_id: enrollmentId,
    serial_number: serialNumber,
    created_at: createdAt,
    expires_at: expiresAt,
  };
}

/**
 * Atomically claims an enrollment by deleting it if it exists and hasn't expired.
 * Returns the enrollment data if successfully claimed, null otherwise.
 * This prevents race conditions where two users try to claim the same enrollment.
 */
export async function claimEnrollment(
  db: D1Database,
  enrollmentId: string
): Promise<DbEnrollment | null> {
  const currentTime = now();

  // Atomically delete and return the enrollment if it exists and hasn't expired
  const result = await db
    .prepare(
      'DELETE FROM enrollments WHERE enrollment_id = ? AND expires_at >= ? RETURNING *'
    )
    .bind(enrollmentId, currentTime)
    .first<DbEnrollment>();

  return result ?? null;
}

export async function deleteExpiredEnrollments(db: D1Database): Promise<number> {
  const result = await db
    .prepare('DELETE FROM enrollments WHERE expires_at < ?')
    .bind(now())
    .run();
  return result.meta.changes || 0;
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
