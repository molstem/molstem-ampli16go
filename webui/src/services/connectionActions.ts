/**
 * Connection actions: the one place that opens/closes the device link and mirrors
 * the result into `useSerialStore` and the app log. Views call these; they never
 * touch the serial store directly.
 */

import { serialService } from './serialService';
import { isEmbeddedBuild } from './connection';
import type { CloudDevice } from './cloudService';
import { useSerialStore, type ConnectingKind } from '../stores/serialStore';
import { useLogStore } from '../stores/logStore';

const BAUD = 115200;

const log = (message: string, type: 'info' | 'success' | 'error' | 'warning') =>
  useLogStore.getState().addLog(message, type);

export function hasWebSerial(): boolean {
  return 'serial' in navigator;
}

export function portDisplayName(port: SerialPort | null): string {
  if (!port) return '';
  const info = port.getInfo();
  if (info.usbVendorId && info.usbProductId) {
    return `USB ${info.usbVendorId.toString(16).toUpperCase()}:${info.usbProductId.toString(16).toUpperCase()}`;
  }
  return 'Serial Port';
}

/** Run one connection attempt with the store's `connecting` flag set for its duration. */
async function attempt(kind: Exclude<ConnectingKind, null>, errorPrefix: string, action: () => Promise<void>): Promise<void> {
  const store = useSerialStore.getState();
  store.setConnecting(kind);
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    useSerialStore.getState().setStatus(`${errorPrefix}: ${message}`, 'error');
    log(`${errorPrefix}: ${message}`, 'error');
    throw error;
  } finally {
    useSerialStore.getState().setConnecting(null);
  }
}

function markConnected(port: SerialPort | null, status: string, logLine: string): void {
  const { setPort, setIsConnected, setStatus } = useSerialStore.getState();
  setPort(port);
  setIsConnected(true);
  setStatus(status, 'success');
  log(logLine, 'success');
}

/** Connect over Web Serial. Without a port the browser's port picker is shown. */
export function connectSerial(port?: SerialPort, kind: 'serial' | 'auto' = 'serial'): Promise<void> {
  return attempt(kind, 'Connection error', async () => {
    const chosen = port ?? (await serialService.requestPort());
    await serialService.connect(chosen, BAUD);
    const name = portDisplayName(chosen);
    markConnected(chosen, `Connected to ${name}`, `Connected to ${name} at ${BAUD} baud`);
  });
}

/** Connect to the ESP32 that served the page (embedded build only). */
export function connectEmbeddedWebSocket(kind: 'ws' | 'auto' = 'ws'): Promise<void> {
  return attempt(kind, 'Connection error', async () => {
    await serialService.connectWebSocket();
    markConnected(null, 'Connected via WebSocket', 'Connected to device via WebSocket');
  });
}

export function connectCloud(device: CloudDevice): Promise<void> {
  return attempt('cloud', 'Cloud connection error', async () => {
    if (!device.online) throw new Error(`${device.name} is offline`);
    await serialService.connectCloud(device.serial_number);
    markConnected(null, `Connected to ${device.name} via Cloud`, `Connected to ${device.name} (${device.serial_number}) via Cloud`);
  });
}

/** User-initiated disconnect (header button, Cancel while identifying). */
export async function disconnectDevice(): Promise<void> {
  const { setPort, setIsConnected, setStatus } = useSerialStore.getState();
  try {
    await serialService.disconnect();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log(`Disconnect error: ${message}`, 'error');
  } finally {
    setPort(null);
    setIsConnected(false);
    setStatus('Not connected', 'error');
    log('Disconnected from device', 'info');
  }
}

/** Mirror an unexpected link loss (USB unplugged, cloud device went away) into the store. */
export function installUnexpectedDisconnectWatcher(): () => void {
  return serialService.onDisconnect(() => {
    const { setPort, setIsConnected, setStatus } = useSerialStore.getState();
    setPort(null);
    setIsConnected(false);
    setStatus('Device disconnected', 'error');
    log('Device disconnected unexpectedly', 'error');
  });
}

// Once per page load, not once per mount: the connect view remounts after every
// disconnect and must not immediately reconnect the port the user just closed.
let autoConnectAttempted = false;

/**
 * Silently connect when there is no choice to make: the embedded build always talks
 * to its own ESP32, and a browser with exactly one previously granted serial port
 * is almost certainly meant to reconnect to it. Progress is visible through the
 * store's `connecting` flag.
 */
export async function tryAutoConnectOnce(): Promise<void> {
  if (autoConnectAttempted) return;
  autoConnectAttempted = true;
  if (useSerialStore.getState().isConnected) return;

  if (isEmbeddedBuild()) {
    log('Auto-connecting via WebSocket...', 'info');
    await connectEmbeddedWebSocket('auto').catch(() => undefined);
    return;
  }

  if (!hasWebSerial()) return;
  const ports = await navigator.serial.getPorts().catch(() => [] as SerialPort[]);
  if (ports.length !== 1) return;

  log('Auto-connecting to available port...', 'info');
  await connectSerial(ports[0], 'auto').catch(() => undefined);
}
