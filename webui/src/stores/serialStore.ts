import { create } from 'zustand';
import type { SerialConnectionState, BaudRate } from '../types';

/** Which kind of connection attempt is in flight (null when none). */
export type ConnectingKind = 'serial' | 'ws' | 'cloud' | 'auto' | null;

interface SerialStore extends SerialConnectionState {
  availablePorts: string[];
  connecting: ConnectingKind;
  setPort: (port: SerialPort | null) => void;
  setIsConnected: (connected: boolean) => void;
  setSelectedPort: (port: string) => void;
  setBaudRate: (rate: BaudRate) => void;
  setStatus: (status: string, color: 'success' | 'error') => void;
  setAvailablePorts: (ports: string[]) => void;
  setConnecting: (connecting: ConnectingKind) => void;
  reset: () => void;
}

const initialState: SerialConnectionState = {
  port: null,
  isConnected: false,
  selectedPort: '',
  baudRate: 115200,
  status: 'Not connected',
  statusColor: 'error',
};

export const useSerialStore = create<SerialStore>((set) => ({
  ...initialState,
  availablePorts: [],
  connecting: null,

  setPort: (port) => set({ port }),

  setIsConnected: (connected) => set({ isConnected: connected }),

  setSelectedPort: (port) => set({ selectedPort: port }),

  setBaudRate: (rate) => set({ baudRate: rate }),

  setStatus: (status, color) => set({ status, statusColor: color }),

  setAvailablePorts: (ports) => set({ availablePorts: ports }),

  setConnecting: (connecting) => set({ connecting }),

  reset: () => set({ ...initialState, connecting: null }),
}));
