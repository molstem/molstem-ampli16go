import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { getTheme } from '../../src/theme';
import { WizardProvider } from '../../src/context/WizardContext';
import { SetupModePage } from '../../src/pages/SetupModePage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock API client
vi.mock('../../src/api/client', () => ({
  setupHost: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'ApiError';
    }
  },
}));

import { setupHost } from '../../src/api/client';
const mockSetupHost = setupHost as ReturnType<typeof vi.fn>;

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider theme={getTheme('light')}>
      <MemoryRouter>
        <WizardProvider>
          {ui}
        </WizardProvider>
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe('SetupModePage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockSetupHost.mockClear();
  });

  it('renders page title', () => {
    renderWithProviders(<SetupModePage />);
    expect(screen.getByText(/Device Setup/i)).toBeInTheDocument();
  });

  it('renders Local Use and Cloud Registration cards', () => {
    renderWithProviders(<SetupModePage />);
    expect(screen.getByText(/Local Use/i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud Registration/i)).toBeInTheDocument();
  });

  it('renders device name field', () => {
    renderWithProviders(<SetupModePage />);
    expect(screen.getByLabelText(/Device Name/i)).toBeInTheDocument();
  });

  it('shows password fields when Local mode is selected', () => {
    renderWithProviders(<SetupModePage />);

    // Click Local Use card
    fireEvent.click(screen.getByText(/Local Use/i));

    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm Password/i)).toBeInTheDocument();
  });

  it('hides password fields when Cloud mode is selected', () => {
    renderWithProviders(<SetupModePage />);

    // First select Local to show password fields
    fireEvent.click(screen.getByText(/Local Use/i));
    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();

    // Then select Cloud
    fireEvent.click(screen.getByText(/Cloud Registration/i));
    expect(screen.queryByLabelText(/^Password$/i)).not.toBeInTheDocument();
  });

  it('disables Continue button when form is invalid', () => {
    renderWithProviders(<SetupModePage />);
    const continueButton = screen.getByRole('button', { name: /Continue/i });
    expect(continueButton).toBeDisabled();
  });

  it('enables Continue button when cloud mode form is valid', () => {
    renderWithProviders(<SetupModePage />);

    // Select Cloud mode
    fireEvent.click(screen.getByText(/Cloud Registration/i));

    // Enter device name
    fireEvent.change(screen.getByLabelText(/Device Name/i), {
      target: { value: 'mydevice' },
    });

    const continueButton = screen.getByRole('button', { name: /Continue/i });
    expect(continueButton).not.toBeDisabled();
  });

  it('validates device name format', () => {
    renderWithProviders(<SetupModePage />);

    // Enter invalid device name
    fireEvent.change(screen.getByLabelText(/Device Name/i), {
      target: { value: '-invalid' },
    });

    expect(screen.getByText(/DNS-compatible/i)).toBeInTheDocument();
  });

  it('validates password match', () => {
    renderWithProviders(<SetupModePage />);

    // Select Local mode
    fireEvent.click(screen.getByText(/Local Use/i));

    // Enter mismatched passwords
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText(/Confirm Password/i), {
      target: { value: 'different' },
    });

    expect(screen.getByText(/Passwords do not match/i)).toBeInTheDocument();
  });

  it('calls API and navigates on successful submit', async () => {
    mockSetupHost.mockResolvedValue({ status: 'success' });

    renderWithProviders(<SetupModePage />);

    // Fill form for cloud mode
    fireEvent.click(screen.getByText(/Cloud Registration/i));
    fireEvent.change(screen.getByLabelText(/Device Name/i), {
      target: { value: 'mydevice' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => {
      expect(mockSetupHost).toHaveBeenCalledWith({
        mode: 'cloud',
        deviceName: 'mydevice',
        password: undefined,
      });
    });

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/wifi');
    });
  });

  it('shows error modal on API failure', async () => {
    mockSetupHost.mockResolvedValue({
      status: 'error',
      message: 'Setup failed',
    });

    renderWithProviders(<SetupModePage />);

    // Fill form
    fireEvent.click(screen.getByText(/Cloud Registration/i));
    fireEvent.change(screen.getByLabelText(/Device Name/i), {
      target: { value: 'mydevice' },
    });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    await waitFor(() => {
      expect(screen.getByText(/Setup failed/i)).toBeInTheDocument();
    });
  });

  it('navigates back when Back button is clicked', () => {
    renderWithProviders(<SetupModePage />);
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
