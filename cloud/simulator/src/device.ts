import WebSocket from 'ws';
import * as https from 'https';
import fetch from 'node-fetch';
import { UartBridge } from './uart-bridge.js';
import {
  loadCertificates,
  createMtlsAgent,
  generateDeviceKeypair,
  loadDeviceKeypair,
  saveDeviceKeypair,
  createDeviceAuthHeader,
  type CertificateConfig,
  type DeviceKeyPair,
} from './certificate.js';
import {
  DeviceRegisterRequestSchema,
  DeviceRegisterResponseSchema,
  WsControlMessageSchema,
  type DeviceRegisterResponse,
} from '@molstem/cloud-shared';

export interface DeviceKeyConfig {
  publicKeyPath: string;
  privateKeyPath: string;
}

export interface DeviceConfig {
  serial: string;
  cloudUrl: string;
  certificates?: CertificateConfig;
  deviceKeys?: DeviceKeyConfig;  // Path to load/save device signing keys
  autoReconnect?: boolean;
  reconnectDelay?: number;
  insecure?: boolean; // Skip TLS verification (for local dev)
}

type DeviceState = 'disconnected' | 'connecting' | 'registering' | 'connected';

export class SimulatedDevice {
  private ws: WebSocket | null = null;
  private config: DeviceConfig;
  private httpsAgent: https.Agent | null = null;
  private deviceKeys: DeviceKeyPair | null = null;
  private uartBridge: UartBridge;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private state: DeviceState = 'disconnected';
  private enrollmentId: string | null = null;

  constructor(config: DeviceConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 5000,
      ...config,
    };

    // Load certificates if provided, or create insecure agent for local dev
    if (config.certificates) {
      const certs = loadCertificates(config.certificates);
      this.httpsAgent = createMtlsAgent(certs);
    } else if (config.insecure) {
      this.httpsAgent = new https.Agent({
        rejectUnauthorized: false, // Allow self-signed certs
      });
    }

    // Load or generate device signing keys
    if (config.deviceKeys) {
      try {
        this.deviceKeys = loadDeviceKeypair(
          config.deviceKeys.publicKeyPath,
          config.deviceKeys.privateKeyPath
        );
        console.log(`[Device ${config.serial}] Loaded device keys from files`);
      } catch {
        // Keys don't exist, generate new ones
        console.log(`[Device ${config.serial}] Generating new device keypair...`);
        this.deviceKeys = generateDeviceKeypair();
        saveDeviceKeypair(
          this.deviceKeys,
          config.deviceKeys.publicKeyPath,
          config.deviceKeys.privateKeyPath
        );
        console.log(`[Device ${config.serial}] Saved device keys to files`);
      }
    } else if (!config.insecure) {
      // Generate ephemeral keys if no path provided (non-dev mode)
      console.log(`[Device ${config.serial}] Generating ephemeral device keypair`);
      this.deviceKeys = generateDeviceKeypair();
    }

    // Create UART bridge: simulated STM32 SCPI responder (docs/serial-api.md)
    this.uartBridge = new UartBridge(config.serial);

    // Forward reply lines to the WebSocket
    this.uartBridge.on('data', (data: Buffer) => {
      this.sendBinary(data);
    });
  }

  get serial(): string {
    return this.config.serial;
  }

  get currentState(): DeviceState {
    return this.state;
  }

  get currentEnrollmentId(): string | null {
    return this.enrollmentId;
  }

  get publicKey(): string | null {
    return this.deviceKeys?.publicKey ?? null;
  }

  /**
   * Register device with cloud service to get enrollment ID
   */
  async register(): Promise<DeviceRegisterResponse> {
    this.state = 'registering';
    console.log(`[Device ${this.config.serial}] Registering with cloud...`);

    const url = `https://${this.config.cloudUrl}/v0/register`;

    // Include public key in request body for first registration
    const body = DeviceRegisterRequestSchema.parse({
      serial_number: this.config.serial,
      public_key: this.deviceKeys?.publicKey,
    });

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add device auth header if we have keys (production mode)
    if (this.deviceKeys) {
      headers['X-Device-Auth'] = createDeviceAuthHeader(
        this.config.serial,
        this.deviceKeys.privateKey
      );
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      agent: this.httpsAgent ?? undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Registration failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const result = DeviceRegisterResponseSchema.parse(data);

    this.enrollmentId = result.enrollment_id;
    console.log(`[Device ${this.config.serial}] Registered successfully`);
    if (result.enrolled) {
      console.log('  Already enrolled to a user (no enrollment code issued)');
    } else {
      console.log(`  Enrollment ID: ${result.enrollment_id}`);
      if (result.expires_at) {
        console.log(`  Expires at: ${new Date(result.expires_at * 1000).toISOString()}`);
      }
    }

    return result;
  }

  /**
   * Connect to cloud WebSocket endpoint
   */
  async connect(): Promise<void> {
    if (this.ws) {
      console.log(`[Device ${this.config.serial}] Already connected, closing existing connection`);
      this.ws.close();
    }

    this.state = 'connecting';
    console.log(`[Device ${this.config.serial}] Connecting to ${this.config.cloudUrl}...`);

    return new Promise((resolve, reject) => {
      // In insecure/dev mode, pass serial as query param since no mTLS
      let wsUrl = `wss://${this.config.cloudUrl}/v0/ws`;
      if (this.config.insecure) {
        wsUrl += `?serial=${encodeURIComponent(this.config.serial)}`;
      }

      const options: WebSocket.ClientOptions = {};
      if (this.httpsAgent) {
        options.agent = this.httpsAgent;
      }

      // Add device auth header for production mode (with signing keys)
      if (this.deviceKeys && !this.config.insecure) {
        options.headers = {
          'X-Device-Auth': createDeviceAuthHeader(
            this.config.serial,
            this.deviceKeys.privateKey
          ),
        };
      }

      this.ws = new WebSocket(wsUrl, options);
      this.ws.binaryType = 'arraybuffer';

      this.ws.on('open', () => {
        this.state = 'connected';
        console.log(`[Device ${this.config.serial}] Connected to cloud`);

        // Start UART simulation
        this.uartBridge.start();

        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        this.state = 'disconnected';
        console.log(
          `[Device ${this.config.serial}] Connection closed: ${code} ${reason.toString()}`
        );

        // Stop UART simulation
        this.uartBridge.stop();

        // Schedule reconnect if enabled
        if (this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error(`[Device ${this.config.serial}] WebSocket error:`, err.message);
        if (this.state === 'connecting') {
          reject(err);
        }
      });
    });
  }

  /**
   * Disconnect from cloud
   */
  disconnect(): void {
    this.config.autoReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting');
      this.ws = null;
    }

    this.uartBridge.stop();
    this.state = 'disconnected';
    console.log(`[Device ${this.config.serial}] Disconnected`);
  }

  /**
   * Send binary data (simulating UART output)
   */
  private sendBinary(data: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  /**
   * Send control message (JSON)
   */
  private sendControl(message: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: WebSocket.Data): void {
    // Binary data - forward to UART bridge
    if (data instanceof ArrayBuffer) {
      const buffer = Buffer.from(data);
      console.log(`[Device ${this.config.serial}] Received ${buffer.length} bytes`);
      this.uartBridge.receiveFromWebSocket(buffer);
      return;
    }

    // String data - try to parse as control message
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        const message = WsControlMessageSchema.safeParse(parsed);

        if (message.success) {
          this.handleControlMessage(message.data);
        } else {
          console.log(`[Device ${this.config.serial}] Unknown control message:`, parsed);
        }
      } catch {
        // Not JSON: a request line for the SCPI responder
        const buffer = Buffer.from(data, 'utf-8');
        this.uartBridge.receiveFromWebSocket(buffer);
      }
      return;
    }

    // Buffer data
    if (Buffer.isBuffer(data)) {
      console.log(`[Device ${this.config.serial}] Received ${data.length} bytes`);
      this.uartBridge.receiveFromWebSocket(data);
      return;
    }

    console.log(`[Device ${this.config.serial}] Unknown data type:`, typeof data);
  }

  /**
   * Handle control messages from server
   */
  private handleControlMessage(message: { type: string }): void {
    switch (message.type) {
      case 'ping':
        this.sendControl({ type: 'pong' });
        break;

      case 'user_connected':
        console.log(`[Device ${this.config.serial}] User connected`);
        break;

      case 'user_disconnected':
        console.log(`[Device ${this.config.serial}] User disconnected`);
        break;

      case 'reregister':
        // The device was unenrolled: fetch a fresh enrollment code like real firmware does
        console.log(`[Device ${this.config.serial}] Unenrolled by the cloud, registering again`);
        this.register()
          .then((r) => {
            if (!r.enrolled) console.log(`  New enrollment ID: ${r.enrollment_id}`);
          })
          .catch((err) => console.error(`[Device ${this.config.serial}] Re-register failed:`, err));
        break;

      default:
        console.log(`[Device ${this.config.serial}] Control message:`, message);
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    console.log(
      `[Device ${this.config.serial}] Scheduling reconnect in ${this.config.reconnectDelay}ms`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((err) => {
        console.error(`[Device ${this.config.serial}] Reconnect failed:`, err.message);
      });
    }, this.config.reconnectDelay);
  }

  /**
   * Get access to the UART bridge for testing
   */
  getUartBridge(): UartBridge {
    return this.uartBridge;
  }
}
