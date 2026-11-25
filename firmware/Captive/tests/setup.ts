import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock fetch globally
global.fetch = vi.fn();

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

// Mock Intl.DateTimeFormat
vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({
  resolvedOptions: () => ({
    locale: 'en-US',
    timeZone: 'America/New_York',
  }),
  format: () => '',
  formatToParts: () => [],
  formatRange: () => '',
  formatRangeToParts: () => [],
}));

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
