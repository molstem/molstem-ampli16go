// Serial Port Types
export interface SerialPortInfo {
  device: string;
  manufacturer?: string;
  product?: string;
}

export interface SerialConnectionState {
  port: SerialPort | null;
  isConnected: boolean;
  selectedPort: string;
  baudRate: number;
  status: string;
  statusColor: 'success' | 'error';
}

// Firmware Types
export interface FirmwareUploadState {
  filePath: string;
  fileName: string;
  progress: number;
  status: string;
  isUploading: boolean;
}

export type FirmwareFileType = 'hex' | 'bin';

// Log Types
export interface LogMessage {
  id: string;
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

// Intel HEX Types
export interface IntelHexRecord {
  address: number;
  type: number;
  data: Uint8Array;
}

// Baud Rate Options
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
export type BaudRate = typeof BAUD_RATES[number];
