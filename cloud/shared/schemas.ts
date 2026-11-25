import { z } from 'zod';

// Device serial number format: MOLSTEM-{10 Crockford base32 characters}
// Crockford base32 alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (excludes I, L, O, U)
const CROCKFORD_BASE32_REGEX = /^MOLSTEM-[0-9A-HJKMNP-TV-Z]{10}$/;

// Enrollment ID format: XXXX-XXXX (hex)
const ENROLLMENT_ID_REGEX = /^[0-9A-F]{4}-[0-9A-F]{4}$/;

// ============================================================================
// Device Schemas
// ============================================================================

export const DeviceSerialSchema = z.string().regex(
  CROCKFORD_BASE32_REGEX,
  'Invalid device serial format. Expected MOLSTEM-{10 base32 chars}'
);

export const EnrollmentIdSchema = z.string().regex(
  ENROLLMENT_ID_REGEX,
  'Invalid enrollment ID format. Expected XXXX-XXXX'
);

// ============================================================================
// Device Authentication Schemas (for per-device key signing)
// ============================================================================

// Base64-encoded SPKI public key (P-256/secp256r1)
export const PublicKeySchema = z.string()
  .min(80).max(200)
  .regex(/^[A-Za-z0-9+/=]+$/, 'Invalid base64 format for public key');

// Device authentication header payload (X-Device-Auth header, base64-encoded JSON)
export const DeviceAuthHeaderSchema = z.object({
  serial: DeviceSerialSchema,
  timestamp: z.number().int().positive(),  // Unix timestamp in seconds
  nonce: z.string().length(32),            // 16 bytes hex-encoded
  signature: z.string().min(80).max(200),  // Base64-encoded ECDSA signature
});

// POST /api/device/register - Device registers itself
export const DeviceRegisterRequestSchema = z.object({
  serial_number: DeviceSerialSchema,
  public_key: PublicKeySchema.optional(),  // Optional if pre-provisioned via admin
});

export const DeviceRegisterResponseSchema = z.object({
  // true when the device already belongs to a user: no enrollment code is issued
  enrolled: z.boolean(),
  enrollment_id: EnrollmentIdSchema.nullable(),
  expires_at: z.number().int().positive().nullable(),
});

// ============================================================================
// Enrollment Schemas
// ============================================================================

// GET /api/enrollment/{id} - Check enrollment status
export const EnrollmentStatusResponseSchema = z.object({
  enrollment_id: EnrollmentIdSchema,
  serial_number: DeviceSerialSchema,
  created_at: z.number().int().positive(),
  expires_at: z.number().int().positive(),
  claimed: z.boolean(),
  device_name: z.string().nullable(),
});

// POST /api/enrollment/{id} - User claims enrollment
export const ClaimEnrollmentRequestSchema = z.object({
  name: z.string().min(1).max(63).optional(),
});

export const ClaimEnrollmentResponseSchema = z.object({
  success: z.literal(true),
  device: z.object({
    serial_number: DeviceSerialSchema,
    name: z.string(),
    enrolled_at: z.number().int().positive(),
  }),
});

// ============================================================================
// User Device Schemas
// ============================================================================

export const DeviceSchema = z.object({
  serial_number: DeviceSerialSchema,
  name: z.string(),
  enrolled_at: z.number().int().positive(),
  last_seen_at: z.number().int().positive().nullable(),
  online: z.boolean(),
});

// GET /api/devices - List user's devices
export const DeviceListResponseSchema = z.object({
  devices: z.array(DeviceSchema),
});

// DELETE /api/devices/{serial} - Remove device
export const RemoveDeviceResponseSchema = z.object({
  success: z.literal(true),
});

// ============================================================================
// Auth Schemas
// ============================================================================

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  picture_url: z.string().url().nullable(),
});

// GET /auth/me - Current user info
export const AuthMeResponseSchema = z.object({
  user: UserSchema,
});

// Session data stored in KV
export const SessionDataSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  expires_at: z.number().int().positive(),
});

// OAuth state stored in KV
export const OAuthStateSchema = z.object({
  nonce: z.string(),
  redirect_uri: z.string().optional(),
  created_at: z.number().int().positive(),
});

// Google OAuth token response
export const GoogleTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
});

// Google userinfo response
export const GoogleUserInfoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  verified_email: z.boolean().optional(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  picture: z.string().url().optional(),
});

// ============================================================================
// WebSocket Message Schemas
// ============================================================================

// Control messages for WebSocket (text frames)
export const WsControlMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ping'),
  }),
  z.object({
    type: z.literal('pong'),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
  z.object({
    type: z.literal('device_connected'),
    serial_number: DeviceSerialSchema,
  }),
  z.object({
    type: z.literal('device_disconnected'),
    serial_number: DeviceSerialSchema,
  }),
  z.object({
    type: z.literal('user_connected'),
    user_id: z.string().uuid(),
  }),
  z.object({
    type: z.literal('user_disconnected'),
    user_id: z.string().uuid(),
  }),
  // Cloud -> device: the device was unenrolled; register again to get a fresh code
  z.object({
    type: z.literal('reregister'),
  }),
]);

// ============================================================================
// Error Schemas
// ============================================================================

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});

// ============================================================================
// Admin API Schemas
// ============================================================================

// POST /admin/devices - Pre-provision a device with its public key
export const AdminProvisionDeviceRequestSchema = z.object({
  serial_number: DeviceSerialSchema,
  public_key: PublicKeySchema,
  name: z.string().min(1).max(63).optional(),
});

export const AdminProvisionDeviceResponseSchema = z.object({
  success: z.literal(true),
  device: z.object({
    serial_number: DeviceSerialSchema,
    public_key: PublicKeySchema,
    name: z.string().nullable(),
    created_at: z.number().int().positive(),
  }),
});

// GET /admin/devices - List all devices (admin view)
export const AdminDeviceSchema = z.object({
  serial_number: DeviceSerialSchema,
  public_key: z.string().nullable(),
  user_id: z.string().uuid().nullable(),
  name: z.string().nullable(),
  enrolled_at: z.number().int().positive().nullable(),
  last_seen_at: z.number().int().positive().nullable(),
  created_at: z.number().int().positive(),
});

export const AdminDeviceListResponseSchema = z.object({
  devices: z.array(AdminDeviceSchema),
});

// GET /admin/users - List all users
export const AdminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
  picture_url: z.string().url().nullable(),
  created_at: z.number().int().positive(),
  last_login_at: z.number().int().positive().nullable(),
});

export const AdminUserListResponseSchema = z.object({
  users: z.array(AdminUserSchema),
});

// GET /admin/enrollments - List all enrollments
export const AdminEnrollmentSchema = z.object({
  enrollment_id: EnrollmentIdSchema,
  serial_number: DeviceSerialSchema,
  created_at: z.number().int().positive(),
  expires_at: z.number().int().positive(),
});

export const AdminEnrollmentListResponseSchema = z.object({
  enrollments: z.array(AdminEnrollmentSchema),
});

// GET /admin/provisions - List all provisions
export const AdminProvisionSchema = z.object({
  id: z.number().int().positive(),
  serial_number: DeviceSerialSchema,
  attestation_hash: z.string(),
  provision_mode: z.enum(['development', 'production']),
  hw_version: z.string().nullable(),
  provisioned_by: z.string().nullable(),
  created_at: z.number().int().positive(),
  signed_off_at: z.number().int().positive().nullable(),
});

export const AdminProvisionListResponseSchema = z.object({
  provisions: z.array(AdminProvisionSchema),
});

// ============================================================================
// Admin Provisioning Workflow Schemas
// ============================================================================

// Admin payload from device (Step 1 of device provisioning)
export const AdminDevicePayloadSchema = z.object({
  serial: DeviceSerialSchema,
  publicKey: z.string(), // PEM format public key
  wifiMac: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
  chipId: z.string(),
  nonce: z.string().min(32).max(64), // Hex-encoded random nonce
});

// POST /api/provision/prepare-key-exchange
export const PrepareKeyExchangeRequestSchema = AdminDevicePayloadSchema;

export const PrepareKeyExchangeResponseSchema = z.object({
  payload: z.string(), // Base64-encoded encrypted mTLS credentials
});

// Calibration parameters
export const CalibrationSchema = z.object({
  kp: z.number(),
  ti: z.number(),
  td: z.number(),
  tf: z.number(),
  kb: z.number(),
});

// Attestation data structure (from device)
export const AttestationDataSchema = z.object({
  serial: DeviceSerialSchema,
  publicKey: z.string(),
  mtlsCert: z.string(),
  paPubKey: z.string(),
  calibration: CalibrationSchema,
  hwVersion: z.string(),
  hwComment: z.string().nullable(),
  provisionMode: z.enum(['development', 'production']),
  hardwareTests: z.array(z.object({
    id: z.string(),
    status: z.enum(['passed', 'failed', 'skipped']),
  })).optional(),
});

// POST /api/provision/verify-attestation
export const VerifyAttestationRequestSchema = z.object({
  attestation: z.string(), // Base64-encoded attestation from device
});

export const VerifyAttestationResponseSchema = z.object({
  valid: z.boolean(),
  serial: DeviceSerialSchema,
  publicKey: z.string(),
  calibration: CalibrationSchema,
  hwVersion: z.string(),
  hwComment: z.string().nullable(),
  provisionMode: z.enum(['development', 'production']),
  attestationHash: z.string(), // SHA256 hex of attestation data
});

// POST /api/provision/generate-signoff
export const GenerateSignoffRequestSchema = z.object({
  attestationHash: z.string(),
  serial: DeviceSerialSchema,
});

export const GenerateSignoffResponseSchema = z.object({
  payload: z.string(), // Base64-encoded signed signoff
});

// ============================================================================
// Type Exports (inferred from schemas)
// ============================================================================

export type DeviceSerial = z.infer<typeof DeviceSerialSchema>;
export type EnrollmentId = z.infer<typeof EnrollmentIdSchema>;

export type DeviceRegisterRequest = z.infer<typeof DeviceRegisterRequestSchema>;
export type DeviceRegisterResponse = z.infer<typeof DeviceRegisterResponseSchema>;

export type EnrollmentStatusResponse = z.infer<typeof EnrollmentStatusResponseSchema>;
export type ClaimEnrollmentRequest = z.infer<typeof ClaimEnrollmentRequestSchema>;
export type ClaimEnrollmentResponse = z.infer<typeof ClaimEnrollmentResponseSchema>;

export type Device = z.infer<typeof DeviceSchema>;
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;
export type RemoveDeviceResponse = z.infer<typeof RemoveDeviceResponseSchema>;

export type User = z.infer<typeof UserSchema>;
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;
export type SessionData = z.infer<typeof SessionDataSchema>;
export type OAuthState = z.infer<typeof OAuthStateSchema>;
export type GoogleTokenResponse = z.infer<typeof GoogleTokenResponseSchema>;
export type GoogleUserInfo = z.infer<typeof GoogleUserInfoSchema>;

export type WsControlMessage = z.infer<typeof WsControlMessageSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

// Device authentication types
export type PublicKey = z.infer<typeof PublicKeySchema>;
export type DeviceAuthHeader = z.infer<typeof DeviceAuthHeaderSchema>;

// Admin types
export type AdminProvisionDeviceRequest = z.infer<typeof AdminProvisionDeviceRequestSchema>;
export type AdminProvisionDeviceResponse = z.infer<typeof AdminProvisionDeviceResponseSchema>;
export type AdminDevice = z.infer<typeof AdminDeviceSchema>;
export type AdminDeviceListResponse = z.infer<typeof AdminDeviceListResponseSchema>;
export type AdminUser = z.infer<typeof AdminUserSchema>;
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;
export type AdminEnrollment = z.infer<typeof AdminEnrollmentSchema>;
export type AdminEnrollmentListResponse = z.infer<typeof AdminEnrollmentListResponseSchema>;
export type AdminProvision = z.infer<typeof AdminProvisionSchema>;
export type AdminProvisionListResponse = z.infer<typeof AdminProvisionListResponseSchema>;

// Provisioning workflow types
export type AdminDevicePayload = z.infer<typeof AdminDevicePayloadSchema>;
export type PrepareKeyExchangeRequest = z.infer<typeof PrepareKeyExchangeRequestSchema>;
export type PrepareKeyExchangeResponse = z.infer<typeof PrepareKeyExchangeResponseSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type AttestationData = z.infer<typeof AttestationDataSchema>;
export type VerifyAttestationRequest = z.infer<typeof VerifyAttestationRequestSchema>;
export type VerifyAttestationResponse = z.infer<typeof VerifyAttestationResponseSchema>;
export type GenerateSignoffRequest = z.infer<typeof GenerateSignoffRequestSchema>;
export type GenerateSignoffResponse = z.infer<typeof GenerateSignoffResponseSchema>;
