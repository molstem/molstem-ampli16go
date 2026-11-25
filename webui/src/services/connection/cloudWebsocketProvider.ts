import type { ConnectionProvider } from './types';

/**
 * Cloud WebSocket Connection Provider
 * Handles communication via cloud proxy WebSocket (connects to devices via app.molstem.com)
 */
export class CloudWebSocketConnectionProvider implements ConnectionProvider {
  readonly type = 'websocket' as const;
  readonly name = 'Cloud';

  private socket: WebSocket | null = null;
  private dataCallbacks: Set<(data: Uint8Array) => void> = new Set();
  private disconnectCallbacks: Set<() => void> = new Set();
  private deviceSerial: string;
  private connectPromise: { resolve: () => void; reject: (err: Error) => void } | null = null;

  constructor(deviceSerial: string) {
    this.deviceSerial = deviceSerial;
  }

  private getWebSocketUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/v0/ws?device=${encodeURIComponent(this.deviceSerial)}`;
  }

  isSupported(): boolean {
    return 'WebSocket' in window;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  setDeviceSerial(serial: string): void {
    this.deviceSerial = serial;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      throw new Error('Already connected');
    }

    const url = this.getWebSocketUrl();

    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';
        this.connectPromise = { resolve, reject };

        this.socket.onopen = () => {
          console.log('Cloud WebSocket connected to', url);
          this.connectPromise?.resolve();
          this.connectPromise = null;
        };

        this.socket.onclose = (event) => {
          console.log('Cloud WebSocket closed:', event.code, event.reason);
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
          console.error('Cloud WebSocket error:', event);
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
            // Check if it's a control message (JSON)
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === 'device_disconnected') {
                console.log('Device disconnected from cloud');
                this.disconnectCallbacks.forEach(callback => callback());
                return;
              }
              // Other control messages can be handled here
              console.log('Cloud control message:', msg);
            } catch {
              // Not JSON, treat as data
              const encoder = new TextEncoder();
              const data = encoder.encode(event.data);
              this.dataCallbacks.forEach(callback => callback(data));
            }
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
    return `Cloud: ${this.deviceSerial}`;
  }
}
