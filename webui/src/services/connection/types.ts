/**
 * Connection Provider Interface
 * Abstracts the underlying connection protocol (WebSerial, WebSocket, etc.)
 */

export interface ConnectionProvider {
  /** Unique identifier for this provider type */
  readonly type: 'serial' | 'websocket';

  /** Human-readable name */
  readonly name: string;

  /** Check if this provider is supported in current environment */
  isSupported(): boolean;

  /** Check if currently connected */
  isConnected(): boolean;

  /** Connect to the device */
  connect(): Promise<void>;

  /** Disconnect from the device */
  disconnect(): Promise<void>;

  /** Write data to the device */
  write(data: Uint8Array): Promise<void>;

  /** Register callback for incoming data (binary) */
  onData(callback: (data: Uint8Array) => void): () => void;

  /** Register callback for disconnect events */
  onDisconnect(callback: () => void): () => void;

  /** Get connection info for display */
  getConnectionInfo(): string;
}

/**
 * Options for serial port connection
 */
export interface SerialConnectionOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
}

/**
 * Options for WebSocket connection
 */
export interface WebSocketConnectionOptions {
  url: string;
}
