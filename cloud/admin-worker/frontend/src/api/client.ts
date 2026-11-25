import { z } from 'zod';
import {
  AdminDeviceListResponseSchema,
  AdminUserListResponseSchema,
  AdminEnrollmentListResponseSchema,
  AdminProvisionListResponseSchema,
  PrepareKeyExchangeResponseSchema,
  VerifyAttestationResponseSchema,
  GenerateSignoffResponseSchema,
  ApiErrorSchema,
  type AdminDeviceListResponse,
  type AdminUserListResponse,
  type AdminEnrollmentListResponse,
  type AdminProvisionListResponse,
  type PrepareKeyExchangeRequest,
  type PrepareKeyExchangeResponse,
  type VerifyAttestationRequest,
  type VerifyAttestationResponse,
  type GenerateSignoffRequest,
  type GenerateSignoffResponse,
} from '@molstem/cloud-shared';

export type {
  PrepareKeyExchangeRequest,
  PrepareKeyExchangeResponse,
  VerifyAttestationRequest,
  VerifyAttestationResponse,
  GenerateSignoffRequest,
  GenerateSignoffResponse,
};

class ApiClient {
  private async request<T>(
    path: string,
    options: RequestInit = {},
    schema: z.ZodType<T>
  ): Promise<T> {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      const error = ApiErrorSchema.safeParse(data);
      if (error.success) {
        throw new ApiError(error.data.error, error.data.message);
      }
      throw new ApiError('unknown_error', 'An unknown error occurred');
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      console.error('Schema validation failed:', parsed.error);
      throw new ApiError('validation_error', 'Invalid response from server');
    }

    return parsed.data;
  }

  // Devices
  async getDevices(): Promise<AdminDeviceListResponse> {
    return this.request('/devices', { method: 'GET' }, AdminDeviceListResponseSchema);
  }

  // Users
  async getUsers(): Promise<AdminUserListResponse> {
    return this.request('/users', { method: 'GET' }, AdminUserListResponseSchema);
  }

  // Enrollments
  async getEnrollments(): Promise<AdminEnrollmentListResponse> {
    return this.request('/enrollments', { method: 'GET' }, AdminEnrollmentListResponseSchema);
  }

  // Provisions
  async getProvisions(): Promise<AdminProvisionListResponse> {
    return this.request('/provisions', { method: 'GET' }, AdminProvisionListResponseSchema);
  }

  // Provisioning - Step 1: Prepare key exchange (generate mTLS credentials)
  async prepareKeyExchange(data: PrepareKeyExchangeRequest): Promise<PrepareKeyExchangeResponse> {
    return this.request(
      '/provision/prepare-key-exchange',
      { method: 'POST', body: JSON.stringify(data) },
      PrepareKeyExchangeResponseSchema
    );
  }

  // Provisioning - Step 2: Verify attestation from device
  async verifyAttestation(data: VerifyAttestationRequest): Promise<VerifyAttestationResponse> {
    return this.request(
      '/provision/verify-attestation',
      { method: 'POST', body: JSON.stringify(data) },
      VerifyAttestationResponseSchema
    );
  }

  // Provisioning - Step 3: Generate signoff
  async generateSignoff(data: GenerateSignoffRequest): Promise<GenerateSignoffResponse> {
    return this.request(
      '/provision/generate-signoff',
      { method: 'POST', body: JSON.stringify(data) },
      GenerateSignoffResponseSchema
    );
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = new ApiClient();
