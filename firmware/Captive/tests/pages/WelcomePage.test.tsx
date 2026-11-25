import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material';
import { getTheme } from '../../src/theme';
import { WizardProvider } from '../../src/context/WizardContext';
import { WelcomePage } from '../../src/pages/WelcomePage';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

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

describe('WelcomePage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders welcome heading', () => {
    renderWithProviders(<WelcomePage />);
    expect(screen.getByText(/Welcome to your molstem thermocycler/i)).toBeInTheDocument();
  });

  it('renders molstem logo', () => {
    renderWithProviders(<WelcomePage />);
    const logo = screen.getByAltText(/molstem logo/i);
    expect(logo).toBeInTheDocument();
  });

  it('renders Get Started button', () => {
    renderWithProviders(<WelcomePage />);
    expect(screen.getByRole('button', { name: /Get Started/i })).toBeInTheDocument();
  });

  it('navigates to setup page when Get Started is clicked', () => {
    renderWithProviders(<WelcomePage />);
    const button = screen.getByRole('button', { name: /Get Started/i });
    fireEvent.click(button);
    expect(mockNavigate).toHaveBeenCalledWith('/setup');
  });

  it('renders key features section', () => {
    renderWithProviders(<WelcomePage />);
    expect(screen.getByText(/Key Features/i)).toBeInTheDocument();
    expect(screen.getByText(/Rapid Thermal Cycling/i)).toBeInTheDocument();
    expect(screen.getByText(/Compact/i)).toBeInTheDocument();
    expect(screen.getByText(/Smart Connectivity/i)).toBeInTheDocument();
  });

  it('renders setup wizard steps info', () => {
    renderWithProviders(<WelcomePage />);
    expect(screen.getByText(/Setup Wizard/i)).toBeInTheDocument();
    expect(screen.getByText(/Device Configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/Network Connection/i)).toBeInTheDocument();
  });
});
