/**
 * Connection Service
 * Unified interface for device communication, abstracting the underlying protocol
 */

import type { ConnectionProvider } from './types';
import { SerialConnectionProvider } from './serialProvider';
import { WebSocketConnectionProvider } from './websocketProvider';

export type { ConnectionProvider, SerialConnectionOptions, WebSocketConnectionOptions } from './types';
export { SerialConnectionProvider } from './serialProvider';
export { WebSocketConnectionProvider } from './websocketProvider';

/**
 * True only for the single-file build served by the ESP32 (`vite.config.embed.ts`).
 * Unlike `isEmbeddedMode()` this does not treat "no Web Serial" (phones, Firefox,
 * Safari) as embedded, so the UI can still offer the cloud there.
 */
export function isEmbeddedBuild(): boolean {
  return typeof __EMBEDDED_BUILD__ !== 'undefined' && !!__EMBEDDED_BUILD__;
}

/**
 * Detect if running in embedded mode (served from ESP32)
 * In embedded mode, we use WebSocket instead of Serial
 */
export function isEmbeddedMode(): boolean {
  // Check for build-time flag
  if (isEmbeddedBuild()) {
    return true;
  }

  // Runtime detection: check if Web Serial is unavailable
  // (embedded browsers typically don't support it)
  if (!('serial' in navigator)) {
    return true;
  }

  return false;
}

/**
 * Create the appropriate connection provider based on environment
 */
export function createConnectionProvider(): ConnectionProvider {
  if (isEmbeddedMode()) {
    return new WebSocketConnectionProvider();
  }
  return new SerialConnectionProvider();
}

// Declare build-time constant
declare const __EMBEDDED_BUILD__: boolean | undefined;

/**
 * Connection Service Class
 * Provides a unified API for device communication with text conversion helpers
 */
class ConnectionService {
  private provider: ConnectionProvider | null = null;
  private textDecoder = new TextDecoder();
  private textEncoder = new TextEncoder();
  private textDataCallbacks: Set<(data: string) => void> = new Set();
  private binaryDataCallbacks: Set<(data: Uint8Array) => void> = new Set();
  private disconnectCallbacks: Set<() => void> = new Set();
  private dataCleanup: (() => void) | null = null;
  private disconnectCleanup: (() => void) | null = null;

  /**
   * Get the current provider (for advanced operations)
   */
  getProvider(): ConnectionProvider | null {
    return this.provider;
  }

  /**
   * Set a specific provider
   */
  setProvider(provider: ConnectionProvider): void {
    if (this.provider && this.provider.isConnected()) {
      throw new Error('Cannot change provider while connected');
    }
    this.cleanupCallbacks();
    this.provider = provider;
    this.setupCallbacks();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.provider?.isConnected() ?? false;
  }

  /**
   * Get provider type
   */
  getProviderType(): 'serial' | 'websocket' | null {
    return this.provider?.type ?? null;
  }

  /**
   * Connect using the current provider
   */
  async connect(): Promise<void> {
    if (!this.provider) {
      throw new Error('No provider set');
    }
    await this.provider.connect();
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    if (this.provider) {
      await this.provider.disconnect();
      this.cleanupCallbacks();
      this.provider = null;
    }
  }

  /**
   * Write string data
   */
  async write(data: string): Promise<void> {
    if (!this.provider) {
      throw new Error('Not connected');
    }
    const bytes = this.textEncoder.encode(data);
    await this.provider.write(bytes);
  }

  /**
   * Write binary data
   */
  async writeBytes(data: Uint8Array): Promise<void> {
    if (!this.provider) {
      throw new Error('Not connected');
    }
    await this.provider.write(data);
  }

  /**
   * Register callback for incoming text data
   */
  onData(callback: (data: string) => void): () => void {
    this.textDataCallbacks.add(callback);
    return () => {
      this.textDataCallbacks.delete(callback);
    };
  }

  /**
   * Register callback for incoming binary data
   */
  onBinaryData(callback: (data: Uint8Array) => void): () => void {
    this.binaryDataCallbacks.add(callback);
    return () => {
      this.binaryDataCallbacks.delete(callback);
    };
  }

  /**
   * Register callback for disconnect events
   */
  onDisconnect(callback: () => void): () => void {
    this.disconnectCallbacks.add(callback);
    return () => {
      this.disconnectCallbacks.delete(callback);
    };
  }

  /**
   * Get connection info string
   */
  getConnectionInfo(): string {
    return this.provider?.getConnectionInfo() ?? 'Not connected';
  }

  private setupCallbacks(): void {
    if (!this.provider) return;

    this.dataCleanup = this.provider.onData((data: Uint8Array) => {
      // Notify binary callbacks
      this.binaryDataCallbacks.forEach(callback => callback(data));

      // Convert to text and notify text callbacks
      if (this.textDataCallbacks.size > 0) {
        const text = this.textDecoder.decode(data, { stream: true });
        this.textDataCallbacks.forEach(callback => callback(text));
      }
    });

    this.disconnectCleanup = this.provider.onDisconnect(() => {
      this.disconnectCallbacks.forEach(callback => callback());
    });
  }

  private cleanupCallbacks(): void {
    this.dataCleanup?.();
    this.disconnectCleanup?.();
    this.dataCleanup = null;
    this.disconnectCleanup = null;
  }
}

// Export singleton instance
export const connectionService = new ConnectionService();
