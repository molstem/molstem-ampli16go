import { describe, it, expect } from 'vitest';
import {
  HostSetupRequestSchema,
  WifiSetupRequestSchema,
  WifiScanResponseSchema,
  StatusResponseSchema,
  isValidDnsName,
} from '../../src/api/schemas';

describe('HostSetupRequestSchema', () => {
  it('validates valid local mode request', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'local',
      deviceName: 'molstem-lab1',
      password: 'securepassword123',
    });
    expect(result.success).toBe(true);
  });

  it('validates valid cloud mode request without password', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: 'molstem-research',
    });
    expect(result.success).toBe(true);
  });

  it('rejects local mode without password', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'local',
      deviceName: 'molstem-lab1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects local mode with short password', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'local',
      deviceName: 'molstem-lab1',
      password: '12345',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid DNS name with leading hyphen', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: '-molstem',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid DNS name with trailing hyphen', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: 'molstem-',
    });
    expect(result.success).toBe(false);
  });

  it('rejects DNS name with spaces', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: 'easy pcr',
    });
    expect(result.success).toBe(false);
  });

  it('rejects DNS name with special characters', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: 'molstem@lab',
    });
    expect(result.success).toBe(false);
  });

  it('accepts DNS name with numbers', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: 'molstem123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty device name', () => {
    const result = HostSetupRequestSchema.safeParse({
      mode: 'cloud',
      deviceName: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('WifiSetupRequestSchema', () => {
  it('validates valid request', () => {
    const result = WifiSetupRequestSchema.safeParse({
      ssid: 'MyNetwork',
      password: 'mypassword',
      region: 'US',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty password for open networks', () => {
    const result = WifiSetupRequestSchema.safeParse({
      ssid: 'OpenNetwork',
      password: '',
      region: 'GB',
      timezone: 'Europe/London',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty SSID', () => {
    const result = WifiSetupRequestSchema.safeParse({
      ssid: '',
      region: 'US',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing region', () => {
    const result = WifiSetupRequestSchema.safeParse({
      ssid: 'MyNetwork',
      timezone: 'America/New_York',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing timezone', () => {
    const result = WifiSetupRequestSchema.safeParse({
      ssid: 'MyNetwork',
      region: 'US',
    });
    expect(result.success).toBe(false);
  });
});

describe('WifiScanResponseSchema', () => {
  it('validates valid response', () => {
    const result = WifiScanResponseSchema.safeParse({
      status: 'success',
      networks: [
        { ssid: 'Network1', rssi: -45, secure: true },
        { ssid: 'Network2', rssi: -70, secure: false },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates empty networks list', () => {
    const result = WifiScanResponseSchema.safeParse({
      status: 'success',
      networks: [],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid network object', () => {
    const result = WifiScanResponseSchema.safeParse({
      status: 'success',
      networks: [{ ssid: 'Network1' }], // missing rssi and secure
    });
    expect(result.success).toBe(false);
  });
});

describe('StatusResponseSchema', () => {
  it('validates disconnected state', () => {
    const result = StatusResponseSchema.safeParse({
      status: 'success',
      state: 'disconnected',
      id: 'MOLSTEM-2024-ABC123',
    });
    expect(result.success).toBe(true);
  });

  it('validates local state with link and ip', () => {
    const result = StatusResponseSchema.safeParse({
      status: 'success',
      state: 'local',
      id: 'MOLSTEM-2024-ABC123',
      link: 'http://molstem-lab.local',
      ip: '192.168.1.100',
    });
    expect(result.success).toBe(true);
  });

  it('validates cloud state with enrollment id', () => {
    const result = StatusResponseSchema.safeParse({
      status: 'success',
      state: 'cloud',
      id: 'MOLSTEM-2024-ABC123',
      link: 'ENROLL-ABCD-1234',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid state', () => {
    const result = StatusResponseSchema.safeParse({
      status: 'success',
      state: 'invalid',
      id: 'MOLSTEM-2024-ABC123',
    });
    expect(result.success).toBe(false);
  });
});

describe('isValidDnsName', () => {
  it('accepts valid DNS names', () => {
    expect(isValidDnsName('molstem')).toBe(true);
    expect(isValidDnsName('molstem-lab1')).toBe(true);
    expect(isValidDnsName('lab-pcr-001')).toBe(true);
    expect(isValidDnsName('a')).toBe(true);
    expect(isValidDnsName('123')).toBe(true);
    expect(isValidDnsName('a1b2c3')).toBe(true);
  });

  it('rejects invalid DNS names', () => {
    expect(isValidDnsName('')).toBe(false);
    expect(isValidDnsName('-molstem')).toBe(false);
    expect(isValidDnsName('molstem-')).toBe(false);
    expect(isValidDnsName('easy pcr')).toBe(false);
    expect(isValidDnsName('easy_pcr')).toBe(false);
    expect(isValidDnsName('easy.pcr')).toBe(false);
    expect(isValidDnsName('a'.repeat(64))).toBe(false); // too long
  });
});
