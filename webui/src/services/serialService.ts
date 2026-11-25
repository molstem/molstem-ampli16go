/**
 * Serial Service - Backward Compatibility Layer
 *
 * This module provides backward compatibility with the old serialService API
 * while using the new unified connection system underneath.
 *
 * For new code, prefer using connectionService from './connection' directly.
 */

import type { BaudRate } from '../types';
import {
  connectionService,
  SerialConnectionProvider,
  WebSocketConnectionProvider,
  isEmbeddedMode,
} from './connection';
import { CloudWebSocketConnectionProvider } from './connection/cloudWebsocketProvider';

class SerialService {
  private serialProvider: SerialConnectionProvider | null = null;
  private wsProvider: WebSocketConnectionProvider | null = null;
  private cloudProvider: CloudWebSocketConnectionProvider | null = null;

  /**
   * Check if Web Serial API is supported
   */
  isSupported(): boolean {
    // In embedded mode, we use WebSocket which is always supported
    if (isEmbeddedMode()) {
      return true;
    }
    return 'serial' in navigator;
  }

  /**
   * Check if running in embedded mode (WebSocket)
   */
  isEmbeddedMode(): boolean {
    return isEmbeddedMode();
  }

  /**
   * Request user to select a serial port (only in non-embedded mode)
   */
  async requestPort(): Promise<SerialPort> {
    if (isEmbeddedMode()) {
      throw new Error('Serial port selection not available in embedded mode');
    }

    if (!this.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    this.serialProvider = new SerialConnectionProvider();
    const port = await this.serialProvider.requestPort();
    connectionService.setProvider(this.serialProvider);
    return port;
  }

  /**
   * Get list of available serial ports (previously granted)
   */
  async getAvailablePorts(): Promise<SerialPort[]> {
    if (isEmbeddedMode()) {
      return [];
    }

    if (!this.isSupported()) {
      return [];
    }

    const provider = new SerialConnectionProvider();
    return provider.getAvailablePorts();
  }

  /**
   * Connect to a serial port or WebSocket (in embedded mode)
   */
  async connect(port: SerialPort | null, baudRate: BaudRate): Promise<void> {
    if (isEmbeddedMode()) {
      // Use WebSocket in embedded mode
      this.wsProvider = new WebSocketConnectionProvider();
      connectionService.setProvider(this.wsProvider);
      await connectionService.connect();
    } else {
      // Use Serial in non-embedded mode
      if (!port) {
        throw new Error('No port provided');
      }

      if (!this.serialProvider) {
        this.serialProvider = new SerialConnectionProvider({ baudRate });
      }

      this.serialProvider.setPort(port);
      connectionService.setProvider(this.serialProvider);
      await connectionService.connect();
    }
  }

  /**
   * Connect using WebSocket (for embedded mode)
   */
  async connectWebSocket(url?: string): Promise<void> {
    this.wsProvider = new WebSocketConnectionProvider(url);
    connectionService.setProvider(this.wsProvider);
    await connectionService.connect();
  }

  /**
   * Connect to a cloud device via WebSocket proxy
   */
  async connectCloud(deviceSerial: string): Promise<void> {
    // Always disconnect/cleanup any existing connection first
    await this.disconnect();

    this.cloudProvider = new CloudWebSocketConnectionProvider(deviceSerial);
    connectionService.setProvider(this.cloudProvider);
    await connectionService.connect();
  }

  /**
   * Disconnect from the serial port or WebSocket
   */
  async disconnect(): Promise<void> {
    await connectionService.disconnect();
    this.serialProvider = null;
    this.wsProvider = null;
    this.cloudProvider = null;
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return connectionService.isConnected();
  }

  /**
   * Add callback for incoming data
   * Returns a function to remove the callback
   */
  onData(callback: (data: string) => void): () => void {
    return connectionService.onData(callback);
  }

  /**
   * Add callback for disconnect events (including unexpected disconnections)
   * Returns a function to remove the callback
   */
  onDisconnect(callback: () => void): () => void {
    return connectionService.onDisconnect(callback);
  }

  /**
   * Write data to serial port or WebSocket
   */
  async write(data: string | Uint8Array): Promise<void> {
    if (typeof data === 'string') {
      await connectionService.write(data);
    } else {
      await connectionService.writeBytes(data);
    }
  }

  /**
   * Write raw bytes to serial port or WebSocket
   */
  async writeBytes(data: Uint8Array): Promise<void> {
    await connectionService.writeBytes(data);
  }

  /**
   * Get port info
   */
  getPortInfo(): SerialPortInfo | null {
    if (this.serialProvider) {
      return this.serialProvider.getPortInfo();
    }
    return null;
  }

  /**
   * Get connection info string
   */
  getConnectionInfo(): string {
    return connectionService.getConnectionInfo();
  }
}

export const serialService = new SerialService();
