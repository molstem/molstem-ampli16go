/**
 * Web Serial API wrapper for provisioning communication with ESP32 devices.
 *
 * Speaks the SCPI-style line protocol described in docs/serial-api.md:
 * request `<HEADER>[ <arg>[,<arg>...]]\n`, exactly one reply line per request:
 * `OK` / `OK <n>`, `ERR <code>,"<message>"`, or bare query data (JSON here).
 */

export interface SerialResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface DeviceIdn {
  vendor: string;
  model: string;
  serial: string;
  version: string;
}

export interface DeviceIdentity {
  serial: string;
  publicKey: string;
  wifiMac: string;
  chipId: string;
  nonce: string;
}

export interface HardwareTest {
  id: string;
  name: string;
  description: string;
  type: 'automated' | 'interactive' | 'observe_confirm';
  status: 'pending' | 'passed' | 'failed' | 'skipped';
}

export interface ChecklistItem {
  id: string;
  description: string;
  completed: boolean;
}

export interface Attestation {
  data: {
    serial: string;
    publicKey: string;
    mtlsCert: string;
    paPubKey: string;
    calibration: {
      kp: number;
      ti: number;
      td: number;
      tf: number;
      kb: number;
    };
    hwVersion: string;
    hwComment: string;
    provisionMode: 'development' | 'production';
    hardwareTests: Array<{ id: string; status: string }>;
  };
  signature: string;
}

export class SerialConnection {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private lineBuffer = '';
  private responseResolve: ((value: string) => void) | null = null;
  private responseReject: ((error: Error) => void) | null = null;
  private readLoopActive = false;

  /**
   * Check if Web Serial API is supported
   */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  /**
   * Check if connected to a serial port
   */
  isConnected(): boolean {
    return this.port !== null && this.readLoopActive;
  }

  /**
   * Connect to a serial port
   */
  async connect(baudRate = 115200): Promise<void> {
    if (!SerialConnection.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    try {
      // Request port from user
      this.port = await navigator.serial.requestPort();

      // Open the port
      await this.port.open({
        baudRate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
      });

      // Get reader and writer
      if (this.port.readable && this.port.writable) {
        this.reader = this.port.readable.getReader();
        this.writer = this.port.writable.getWriter();
        this.startReadLoop();
        console.log('[SERIAL] Connected');
      } else {
        throw new Error('Port is not readable/writable');
      }
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  /**
   * Disconnect from the serial port
   */
  async disconnect(): Promise<void> {
    console.log('[SERIAL] Disconnecting...');
    this.readLoopActive = false;

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
    } catch (e) {
      console.warn('[SERIAL] Error releasing reader:', e);
    }

    try {
      if (this.writer) {
        await this.writer.close();
        this.writer = null;
      }
    } catch (e) {
      console.warn('[SERIAL] Error closing writer:', e);
    }

    try {
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch (e) {
      console.warn('[SERIAL] Error closing port:', e);
    }

    console.log('[SERIAL] Disconnected');
  }

  private cleanup(): void {
    this.readLoopActive = false;
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.lineBuffer = '';
    this.responseResolve = null;
    this.responseReject = null;
  }

  private async startReadLoop(): Promise<void> {
    this.readLoopActive = true;
    const decoder = new TextDecoder();

    try {
      while (this.readLoopActive && this.reader) {
        const { value, done } = await this.reader.read();
        if (done) {
          console.log('[SERIAL] Read loop ended (done)');
          break;
        }

        const text = decoder.decode(value);
        this.lineBuffer += text;

        // Process complete lines
        const lines = this.lineBuffer.split('\n');
        this.lineBuffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            console.log('[SERIAL RX]', trimmed);
            if (this.responseResolve) {
              const resolve = this.responseResolve;
              this.responseResolve = null;
              this.responseReject = null;
              resolve(trimmed);
            }
          }
        }
      }
    } catch (error) {
      if (this.readLoopActive) {
        console.error('[SERIAL] Read error:', error);
        if (this.responseReject) {
          this.responseReject(error as Error);
          this.responseResolve = null;
          this.responseReject = null;
        }
      }
    }
  }

  /**
   * Send a command and wait for response
   */
  async sendCommand(command: string, payload?: string, timeout = 10000): Promise<SerialResponse> {
    if (!this.writer || !this.isConnected()) {
      throw new Error('Not connected to serial port');
    }

    const line = payload ? `${command} ${payload}\n` : `${command}\n`;
    console.log('[SERIAL TX]', line.trim());

    // Send the command
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(line));

    // Wait for response with timeout
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseResolve = null;
        this.responseReject = null;
        reject(new Error(`Timeout waiting for response to ${command}`));
      }, timeout);

      this.responseResolve = (response: string) => {
        clearTimeout(timer);
        resolve(this.parseResponse(response));
      };

      this.responseReject = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
    });
  }

  /**
   * Parse one reply line (docs/serial-api.md, "Framing"):
   *   `OK` / `OK <n>`            -> ok (data = n when present)
   *   `ERR <code>,"<message>"`   -> error `<code>: <message>` (`""` unescaped)
   *   `{...}` / `[...]`          -> ok, data = parsed JSON
   *   anything else              -> ok, data = raw line (e.g. `*IDN?` CSV)
   */
  private parseResponse(line: string): SerialResponse {
    // OK / OK <n>
    const okMatch = /^OK(?:\s+(\S.*))?$/i.exec(line);
    if (okMatch) {
      if (okMatch[1] !== undefined) {
        const n = Number(okMatch[1]);
        return { ok: true, data: Number.isFinite(n) ? n : okMatch[1] };
      }
      return { ok: true };
    }

    // ERR <code>,"<message>"
    const errMatch = /^ERR\b\s*(.*)$/i.exec(line);
    if (errMatch) {
      const rest = errMatch[1].trim();
      const comma = rest.indexOf(',');
      const code = (comma >= 0 ? rest.substring(0, comma) : rest).trim() || 'UNKNOWN';
      let message = comma >= 0 ? rest.substring(comma + 1).trim() : '';
      if (message.startsWith('"')) {
        // Strip surrounding quotes, unescape doubled quotes
        const end = message.endsWith('"') && message.length > 1 ? message.length - 1 : message.length;
        message = message.substring(1, end).replace(/""/g, '"');
      }
      return { ok: false, error: `${code}: ${message || 'Unknown error'}` };
    }

    // Bare JSON data line
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        return { ok: true, data: JSON.parse(line) };
      } catch (e) {
        console.error('[SERIAL] Failed to parse JSON:', line, e);
        return { ok: false, error: 'Invalid JSON in response' };
      }
    }

    // Other query data (e.g. `*IDN?` -> molstem,<model>,<serial>,<version>)
    return { ok: true, data: line };
  }

  // ============ High-level provisioning commands ============

  /**
   * Identify the device (`*IDN?`) and verify it is in provisioning mode.
   * Throws a descriptive error when the device is already provisioned
   * (application firmware) or sitting in the bootloader.
   */
  async ping(): Promise<DeviceIdn> {
    const response = await this.sendCommand('*IDN?');
    if (!response.ok) {
      throw new Error(response.error || 'Identification failed');
    }

    const line = typeof response.data === 'string' ? response.data : '';
    if (/^BOOTLOADER:/i.test(line)) {
      // Legacy bootloader banner printed until its first command
      throw new Error('Device is in bootloader mode');
    }

    const fields = line.split(',');
    if (fields.length < 4 || fields[0].trim().toLowerCase() !== 'molstem') {
      throw new Error(`Unexpected identification reply: ${line || '(empty)'}`);
    }

    const idn: DeviceIdn = {
      vendor: fields[0].trim(),
      model: fields[1].trim(),
      serial: fields[2].trim(),
      version: fields.slice(3).join(',').trim(),
    };

    switch (idn.model.toLowerCase()) {
      case 'thermocycler-provisioning':
        return idn;
      case 'thermocycler':
        throw new Error('Device is already provisioned');
      case 'thermocycler-bootloader':
        throw new Error('Device is in bootloader mode');
      default:
        throw new Error(`Unknown device model: ${idn.model}`);
    }
  }

  /**
   * Get device identity (generates keys on first call)
   */
  async getIdentity(): Promise<DeviceIdentity> {
    const response = await this.sendCommand('PROV:IDEN?', undefined, 30000); // 30s for key gen
    if (!response.ok) {
      throw new Error(response.error || 'Failed to get identity');
    }
    return response.data as DeviceIdentity;
  }

  /**
   * Send mTLS credentials to device (base64 KeyExchangePayload)
   */
  async setMtls(payload: string): Promise<void> {
    const response = await this.sendCommand('PROV:MTLS', payload);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to set mTLS credentials');
    }
  }

  /**
   * Set calibration parameters
   */
  async setCalibration(kp: number, ti: number, td: number, tf: number, kb: number): Promise<void> {
    const payload = `${kp},${ti},${td},${tf},${kb}`;
    const response = await this.sendCommand('PROV:CAL', payload);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to set calibration');
    }
  }

  /**
   * Set hardware version (base64 JSON)
   */
  async setHwVersion(hwVersion: string, hwComment?: string): Promise<void> {
    const data = { hwVersion, hwComment: hwComment || '' };
    const payload = btoa(JSON.stringify(data));
    const response = await this.sendCommand('PROV:HWV', payload);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to set HW version');
    }
  }

  /**
   * Set provisioning mode
   */
  async setMode(mode: 'development' | 'production'): Promise<void> {
    const response = await this.sendCommand('PROV:MODE', mode.toUpperCase());
    if (!response.ok) {
      throw new Error(response.error || 'Failed to set mode');
    }
  }

  /**
   * Get hardware tests
   */
  async getTests(): Promise<HardwareTest[]> {
    const response = await this.sendCommand('PROV:TEST?');
    if (!response.ok) {
      throw new Error(response.error || 'Failed to get tests');
    }
    return (response.data as { tests: HardwareTest[] }).tests;
  }

  /**
   * Run/mark a hardware test
   */
  async runTest(testId: string, action: 'start' | 'pass' | 'fail'): Promise<void> {
    const response = await this.sendCommand('PROV:TEST', `${testId},${action.toUpperCase()}`);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to run test');
    }
  }

  /**
   * Get production checklist
   */
  async getChecklist(): Promise<ChecklistItem[]> {
    const response = await this.sendCommand('PROV:CHEC?');
    if (!response.ok) {
      throw new Error(response.error || 'Failed to get checklist');
    }
    return (response.data as { items: ChecklistItem[] }).items;
  }

  /**
   * Update checklist item
   */
  async setChecklistItem(itemId: string, completed: boolean): Promise<void> {
    const response = await this.sendCommand('PROV:CHEC', `${itemId},${completed ? 1 : 0}`);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to update checklist');
    }
  }

  /**
   * Get signed attestation from device
   */
  async getAttestation(): Promise<Attestation> {
    const response = await this.sendCommand('PROV:ATT?', undefined, 15000);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to get attestation');
    }
    return response.data as Attestation;
  }

  /**
   * Send signoff to complete provisioning (base64 SignoffPayload)
   */
  async setSignoff(payload: string): Promise<void> {
    const response = await this.sendCommand('PROV:SIGN', payload);
    if (!response.ok) {
      throw new Error(response.error || 'Failed to complete signoff');
    }
  }
}

// Singleton instance
export const serialConnection = new SerialConnection();
