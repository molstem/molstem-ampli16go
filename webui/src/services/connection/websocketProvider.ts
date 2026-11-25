import type { ConnectionProvider } from './types';

/**
 * WebSocket Connection Provider
 * Handles communication via WebSocket (used for embedded ESP32 builds)
 */
export class WebSocketConnectionProvider implements ConnectionProvider {
  readonly type = 'websocket' as const;
  readonly name = 'WebSocket';

  private socket: WebSocket | null = null;
  private dataCallbacks: Set<(data: Uint8Array) => void> = new Set();
  private disconnectCallbacks: Set<() => void> = new Set();
  private url: string;
  private connectPromise: { resolve: () => void; reject: (err: Error) => void } | null = null;

  constructor(url?: string) {
    // Default to current host /ws endpoint
    this.url = url ?? `ws://${window.location.host}/ws`;
  }

  isSupported(): boolean {
    return 'WebSocket' in window;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /**
   * Set the WebSocket URL
   */
  setUrl(url: string): void {
    this.url = url;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      throw new Error('Already connected');
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url);
        this.socket.binaryType = 'arraybuffer';
        this.connectPromise = { resolve, reject };

        this.socket.onopen = () => {
          console.log('WebSocket connected to', this.url);
          this.connectPromise?.resolve();
          this.connectPromise = null;
        };

        this.socket.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          const wasConnected = this.socket !== null;
          this.socket = null;

          if (this.connectPromise) {
            this.connectPromise.reject(new Error(`WebSocket closed: ${event.reason || 'Unknown reason'}`));
            this.connectPromise = null;
          } else if (wasConnected) {
            // Unexpected disconnect
            this.disconnectCallbacks.forEach(callback => callback());
          }
        };

        this.socket.onerror = (event) => {
          console.error('WebSocket error:', event);
          if (this.connectPromise) {
            this.connectPromise.reject(new Error('WebSocket connection failed'));
            this.connectPromise = null;
          }
        };

        this.socket.onmessage = (event) => {
          if (event.data instanceof ArrayBuffer) {
            const data = new Uint8Array(event.data);
            this.dataCallbacks.forEach(callback => callback(data));
          } else if (typeof event.data === 'string') {
            // Convert string to Uint8Array for consistency
            const encoder = new TextEncoder();
            const data = encoder.encode(event.data);
            this.dataCallbacks.forEach(callback => callback(data));
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.close(1000, 'User disconnect');
      this.socket = null;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    // Send as binary blob
    this.socket.send(data);
  }

  onData(callback: (data: Uint8Array) => void): () => void {
    this.dataCallbacks.add(callback);
    return () => {
      this.dataCallbacks.delete(callback);
    };
  }

  onDisconnect(callback: () => void): () => void {
    this.disconnectCallbacks.add(callback);
    return () => {
      this.disconnectCallbacks.delete(callback);
    };
  }

  getConnectionInfo(): string {
    if (!this.socket) {
      return 'Not connected';
    }
    return this.url;
  }
}
