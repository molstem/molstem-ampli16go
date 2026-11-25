import type { ConnectionProvider, SerialConnectionOptions } from './types';

/**
 * Web Serial API Connection Provider
 * Handles serial port communication via browser's Web Serial API
 */
export class SerialConnectionProvider implements ConnectionProvider {
  readonly type = 'serial' as const;
  readonly name = 'Serial Port';

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private dataCallbacks: Set<(data: Uint8Array) => void> = new Set();
  private disconnectCallbacks: Set<() => void> = new Set();
  private isReading = false;
  private options: SerialConnectionOptions;

  constructor(options: SerialConnectionOptions = { baudRate: 115200 }) {
    this.options = options;
  }

  isSupported(): boolean {
    return 'serial' in navigator;
  }

  isConnected(): boolean {
    return this.port !== null && this.reader !== null;
  }

  /**
   * Request user to select a serial port (must be called before connect)
   */
  async requestPort(): Promise<SerialPort> {
    if (!this.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    const port = await navigator.serial.requestPort();
    this.port = port;
    return port;
  }

  /**
   * Get list of available serial ports (previously granted)
   */
  async getAvailablePorts(): Promise<SerialPort[]> {
    if (!this.isSupported()) {
      return [];
    }

    try {
      return await navigator.serial.getPorts();
    } catch (error) {
      console.error('Failed to get ports:', error);
      return [];
    }
  }

  /**
   * Set port to use (for connecting to a previously selected port)
   */
  setPort(port: SerialPort): void {
    this.port = port;
  }

  async connect(): Promise<void> {
    if (!this.port) {
      throw new Error('No port selected. Call requestPort() first.');
    }

    try {
      await this.port.open({
        baudRate: this.options.baudRate,
        dataBits: this.options.dataBits ?? 8,
        stopBits: this.options.stopBits ?? 1,
        parity: this.options.parity ?? 'none',
      });

      if (this.port.readable) {
        this.reader = this.port.readable.getReader();
      }

      if (this.port.writable) {
        this.writer = this.port.writable.getWriter();
      }

      this.startReading();
    } catch (error) {
      throw new Error(`Failed to connect: ${error}`);
    }
  }

  async disconnect(): Promise<void> {
    this.isReading = false;

    // Clean up reader
    if (this.reader) {
      try {
        await this.reader.cancel();
        this.reader.releaseLock();
      } catch (error) {
        console.warn('Error releasing reader:', error);
      }
      this.reader = null;
    }

    // Clean up writer
    if (this.writer) {
      try {
        await this.writer.close();
      } catch (error) {
        console.warn('Error closing writer:', error);
      }
      this.writer = null;
    }

    // Close port
    if (this.port) {
      try {
        await this.port.close();
      } catch (error) {
        // Port may already be closed - this is fine
        console.warn('Error closing port (may already be closed):', error);
      }
      this.port = null;
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('Not connected to a serial port');
    }

    await this.writer.write(data);
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
    if (!this.port) {
      return 'Not connected';
    }

    const info = this.port.getInfo();
    if (info.usbVendorId && info.usbProductId) {
      return `USB ${info.usbVendorId.toString(16)}:${info.usbProductId.toString(16)}`;
    }
    return 'Serial Port';
  }

  /**
   * Get raw port info
   */
  getPortInfo(): SerialPortInfo | null {
    if (!this.port) {
      return null;
    }
    return this.port.getInfo();
  }

  private async startReading(): Promise<void> {
    if (!this.reader || this.isReading) {
      return;
    }

    this.isReading = true;
    let unexpectedDisconnect = false;

    try {
      while (this.isReading && this.reader) {
        const { value, done } = await this.reader.read();

        if (done) {
          unexpectedDisconnect = this.isReading;
          break;
        }

        if (value && this.dataCallbacks.size > 0) {
          this.dataCallbacks.forEach(callback => callback(value));
        }
      }
    } catch (error) {
      if (this.isReading) {
        console.error('Error reading from serial port:', error);
        unexpectedDisconnect = true;
      }
    }

    if (unexpectedDisconnect) {
      this.isReading = false;
      this.reader = null;
      this.writer = null;
      this.port = null;
      this.disconnectCallbacks.forEach(callback => callback());
    }
  }
}
