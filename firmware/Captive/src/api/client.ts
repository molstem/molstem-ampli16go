import { z } from 'zod';
import {
  WifiScanResponseSchema,
  HostSetupRequestSchema,
  HostSetupResponseSchema,
  WifiSetupRequestSchema,
  WifiSetupResponseSchema,
  StatusResponseSchema,
  CommitResponseSchema,
  type WifiScanResponse,
  type HostSetupRequest,
  type ApiResponse,
  type WifiSetupRequest,
  type StatusResponse,
} from './schemas';

class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isNetworkError: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchWithValidation<T>(
  url: string,
  schema: z.ZodType<T>,
  options?: RequestInit & { timeout?: number }
): Promise<T> {
  const { timeout = 30000, ...fetchOptions } = options || {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new ApiError(
        `HTTP ${response.status}: ${response.statusText}`,
        response.status
      );
    }

    const data = await response.json();
    return schema.parse(data);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof z.ZodError) {
      console.error('API response validation failed:', error.errors);
      throw new ApiError('Invalid response from server');
    }

    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('Request timed out', undefined, true);
    }

    if (error instanceof TypeError) {
      throw new ApiError('Network error - unable to connect', undefined, true);
    }

    throw new ApiError(
      error instanceof Error ? error.message : 'Unknown error occurred'
    );
  }
}

// ============ API Functions ============

export async function scanWifiNetworks(): Promise<WifiScanResponse> {
  return fetchWithValidation('/api/wifi-scan', WifiScanResponseSchema);
}

export async function setupHost(request: HostSetupRequest): Promise<ApiResponse> {
  // Validate request before sending
  const validated = HostSetupRequestSchema.parse(request);

  return fetchWithValidation('/api/host-setup', HostSetupResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
  });
}

export async function setupWifi(request: WifiSetupRequest): Promise<ApiResponse> {
  // Validate request before sending
  const validated = WifiSetupRequestSchema.parse(request);

  // Long timeout for WiFi setup - MCU blocks during connection
  return fetchWithValidation('/api/wifi-setup', WifiSetupResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validated),
    timeout: 240000, // 240 seconds
  });
}

export async function getDeviceStatus(): Promise<StatusResponse> {
  return fetchWithValidation('/api/status', StatusResponseSchema);
}

export async function commitSetup(): Promise<ApiResponse> {
  return fetchWithValidation('/api/commit', CommitResponseSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export { ApiError };
