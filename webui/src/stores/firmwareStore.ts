import { create } from 'zustand';
import type { FirmwareUploadState } from '../types';

/**
 * Firmware update page state. Whether the device is in the bootloader is read
 * from the telemetry store (`deviceMode`, from `*IDN?`), not tracked here.
 */
export type FirmwarePhase = 'idle' | 'uploading' | 'finalizing' | 'done' | 'error';

interface FirmwareStore extends FirmwareUploadState {
  phase: FirmwarePhase;
  /** Bytes acknowledged by the bootloader (`OK <n>`). */
  bytesAcked: number;
  totalBytes: number;
  error: { code: number | null; msg: string } | null;
  setFilePath: (path: string) => void;
  setFileName: (name: string) => void;
  setProgress: (progress: number) => void;
  setStatus: (status: string) => void;
  setIsUploading: (uploading: boolean) => void;
  setPhase: (phase: FirmwarePhase) => void;
  setTransfer: (bytesAcked: number, totalBytes: number) => void;
  setError: (error: { code: number | null; msg: string } | null) => void;
  reset: () => void;
}

const initialState: FirmwareUploadState & {
  phase: FirmwarePhase;
  bytesAcked: number;
  totalBytes: number;
  error: { code: number | null; msg: string } | null;
} = {
  filePath: '',
  fileName: '',
  progress: 0,
  status: 'No transfer in progress',
  isUploading: false,
  phase: 'idle',
  bytesAcked: 0,
  totalBytes: 0,
  error: null,
};

export const useFirmwareStore = create<FirmwareStore>((set) => ({
  ...initialState,

  setFilePath: (path) => set({ filePath: path }),

  setFileName: (name) => set({ fileName: name }),

  setProgress: (progress) => set({ progress }),

  setStatus: (status) => set({ status }),

  setIsUploading: (uploading) => set({ isUploading: uploading }),

  setPhase: (phase) => set({ phase }),

  setTransfer: (bytesAcked, totalBytes) =>
    set({
      bytesAcked,
      totalBytes,
      progress: totalBytes > 0 ? Math.min(100, Math.round((bytesAcked / totalBytes) * 100)) : 0,
    }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));
