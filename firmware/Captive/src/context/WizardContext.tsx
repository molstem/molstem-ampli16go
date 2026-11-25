import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SetupMode, WifiNetwork, StatusResponse } from '../api/schemas';

// ============ State Types ============

export interface WizardState {
  // Step 2 data
  setupMode: SetupMode | null;
  deviceName: string;
  password: string;
  confirmPassword: string;

  // Step 3 data
  selectedNetwork: WifiNetwork | null;
  customSsid: string;
  wifiPassword: string;
  region: string;
  timezone: string;

  // Step 4 data
  deviceStatus: StatusResponse | null;
}

type WizardAction =
  | { type: 'SET_SETUP_MODE'; mode: SetupMode }
  | { type: 'SET_DEVICE_NAME'; name: string }
  | { type: 'SET_PASSWORD'; password: string }
  | { type: 'SET_CONFIRM_PASSWORD'; password: string }
  | { type: 'SET_NETWORK'; network: WifiNetwork | null }
  | { type: 'SET_CUSTOM_SSID'; ssid: string }
  | { type: 'SET_WIFI_PASSWORD'; password: string }
  | { type: 'SET_REGION'; region: string }
  | { type: 'SET_TIMEZONE'; timezone: string }
  | { type: 'SET_STATUS'; status: StatusResponse }
  | { type: 'RESET' };

// ============ Timezone to Region Mapping ============

// Map timezone prefixes to ISO country codes
const TIMEZONE_TO_REGION: Record<string, string> = {
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'America/Phoenix': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'America/Lima': 'PE',
  'America/Bogota': 'CO',
  'Europe/London': 'GB',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Bucharest': 'RO',
  'Europe/Sofia': 'BG',
  'Europe/Athens': 'GR',
  'Europe/Dublin': 'IE',
  'Europe/Lisbon': 'PT',
  'Europe/Moscow': 'RU',
  'Europe/Kiev': 'UA',
  'Europe/Istanbul': 'TR',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Manila': 'PH',
  'Asia/Jakarta': 'ID',
  'Asia/Kolkata': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Jerusalem': 'IL',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU',
  'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',
  'Pacific/Fiji': 'FJ',
  'Pacific/Honolulu': 'US',
  'Africa/Cairo': 'EG',
  'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Casablanca': 'MA',
};

function getRegionFromTimezone(timezone: string): string {
  // Direct match
  if (TIMEZONE_TO_REGION[timezone]) {
    return TIMEZONE_TO_REGION[timezone];
  }

  // Try to extract from locale as fallback
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (locale) {
      const parts = locale.split('-');
      if (parts.length >= 2 && parts[1].length === 2) {
        return parts[1].toUpperCase();
      }
    }
  } catch {
    // Ignore errors
  }

  return 'US'; // Default fallback
}

// ============ Initial State ============

function getInitialState(): WizardState {
  // Auto-detect timezone from browser
  const intlOptions = Intl.DateTimeFormat().resolvedOptions();
  const timezone = intlOptions.timeZone || 'UTC';
  const region = getRegionFromTimezone(timezone);

  return {
    setupMode: null,
    deviceName: '',
    password: '',
    confirmPassword: '',
    selectedNetwork: null,
    customSsid: '',
    wifiPassword: '',
    region,
    timezone,
    deviceStatus: null,
  };
}

// ============ Reducer ============

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_SETUP_MODE':
      return { ...state, setupMode: action.mode };
    case 'SET_DEVICE_NAME':
      return { ...state, deviceName: action.name };
    case 'SET_PASSWORD':
      return { ...state, password: action.password };
    case 'SET_CONFIRM_PASSWORD':
      return { ...state, confirmPassword: action.password };
    case 'SET_NETWORK':
      return { ...state, selectedNetwork: action.network };
    case 'SET_CUSTOM_SSID':
      return { ...state, customSsid: action.ssid };
    case 'SET_WIFI_PASSWORD':
      return { ...state, wifiPassword: action.password };
    case 'SET_REGION':
      return { ...state, region: action.region };
    case 'SET_TIMEZONE':
      return { ...state, timezone: action.timezone };
    case 'SET_STATUS':
      return { ...state, deviceStatus: action.status };
    case 'RESET':
      return getInitialState();
    default:
      return state;
  }
}

// ============ Context ============

interface WizardContextValue {
  state: WizardState;
  dispatch: React.Dispatch<WizardAction>;
  goToStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
}

const WizardContext = createContext<WizardContextValue | null>(null);

const STEPS = ['/', '/setup', '/wifi', '/complete'];

// ============ Provider ============

interface WizardProviderProps {
  children: ReactNode;
}

export function WizardProvider({ children }: WizardProviderProps) {
  const [state, dispatch] = useReducer(wizardReducer, null, getInitialState);
  const navigate = useNavigate();

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < STEPS.length) {
      navigate(STEPS[step]);
    }
  }, [navigate]);

  const nextStep = useCallback(() => {
    const currentIndex = STEPS.indexOf(window.location.hash.slice(1) || '/');
    if (currentIndex < STEPS.length - 1) {
      navigate(STEPS[currentIndex + 1]);
    }
  }, [navigate]);

  const prevStep = useCallback(() => {
    const currentIndex = STEPS.indexOf(window.location.hash.slice(1) || '/');
    if (currentIndex > 0) {
      navigate(STEPS[currentIndex - 1]);
    }
  }, [navigate]);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
    navigate(STEPS[0]);
  }, [navigate]);

  return (
    <WizardContext.Provider value={{ state, dispatch, goToStep, nextStep, prevStep, reset }}>
      {children}
    </WizardContext.Provider>
  );
}

// ============ Hook ============

export function useWizard(): WizardContextValue {
  const context = useContext(WizardContext);
  if (!context) {
    throw new Error('useWizard must be used within a WizardProvider');
  }
  return context;
}

export { STEPS };
