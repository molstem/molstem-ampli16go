import { z } from 'zod';

// ============ Common Response Schemas ============

export const ApiSuccessSchema = z.object({
  status: z.literal('success'),
});

export const ApiErrorSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
});

export const ApiResponseSchema = z.discriminatedUnion('status', [
  ApiSuccessSchema,
  ApiErrorSchema,
]);

// ============ Host Setup (Step 2) ============

export const SetupModeSchema = z.enum(['local', 'cloud']);

// DNS-compatible hostname: 1-63 chars, alphanumeric + hyphens, no leading/trailing hyphens
const dnsNameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

export const HostSetupRequestSchema = z.object({
  mode: SetupModeSchema,
  deviceName: z.string()
    .min(1, 'Device name is required')
    .max(63, 'Device name must be 63 characters or less')
    .regex(dnsNameRegex, 'Must be DNS-compatible: letters, numbers, hyphens only; cannot start or end with hyphen'),
  password: z.string().optional(),
}).refine(
  (data) => {
    // Password required only for local mode
    if (data.mode === 'local') {
      return data.password !== undefined && data.password.length >= 6;
    }
    return true;
  },
  {
    message: 'Password must be at least 6 characters for local mode',
    path: ['password'],
  }
);

export const HostSetupResponseSchema = ApiResponseSchema;

// ============ WiFi Scan (Step 3) ============

export const WifiNetworkSchema = z.object({
  ssid: z.string(),
  rssi: z.number(),
  secure: z.boolean(),
});

export const WifiScanResponseSchema = z.object({
  status: z.literal('success'),
  networks: z.array(WifiNetworkSchema),
});

// ============ WiFi Setup (Step 3) ============

export const WifiSetupRequestSchema = z.object({
  ssid: z.string().min(1, 'SSID is required'),
  password: z.string().default(''),
  region: z.string().min(1, 'Region is required'),
  timezone: z.string().min(1, 'Timezone is required'),
});

export const WifiSetupResponseSchema = ApiResponseSchema;

// ============ Device Status (Step 4) ============

export const DeviceStateSchema = z.enum(['disconnected', 'local', 'cloud']);

export const StatusResponseSchema = z.object({
  status: z.literal('success'),
  state: DeviceStateSchema,
  id: z.string(), // Device serial number
  link: z.string().optional(), // mDNS link (local) or enrollment ID (cloud)
  ip: z.string().optional(), // IP address
  enrolled: z.boolean().optional(), // cloud: device already belongs to an account
});

// ============ Commit (Step 4) ============

export const CommitResponseSchema = ApiResponseSchema;

// ============ Type Exports ============

export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type SetupMode = z.infer<typeof SetupModeSchema>;
export type HostSetupRequest = z.infer<typeof HostSetupRequestSchema>;
export type WifiNetwork = z.infer<typeof WifiNetworkSchema>;
export type WifiScanResponse = z.infer<typeof WifiScanResponseSchema>;
export type WifiSetupRequest = z.infer<typeof WifiSetupRequestSchema>;
export type DeviceState = z.infer<typeof DeviceStateSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

// ============ Validation Helpers ============

export function isValidDnsName(name: string): boolean {
  return dnsNameRegex.test(name) && name.length >= 1 && name.length <= 63;
}

export function validateHostSetup(data: unknown): HostSetupRequest {
  return HostSetupRequestSchema.parse(data);
}

export function validateWifiSetup(data: unknown): WifiSetupRequest {
  return WifiSetupRequestSchema.parse(data);
}
