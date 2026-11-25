import type { DurableObjectState } from '@cloudflare/workers-types';
import { WsControlMessageSchema, type WsControlMessage } from '@molstem/cloud-shared';

/**
 * DeviceProxy Durable Object
 *
 * Each device has its own Durable Object instance identified by its serial number.
 * This DO manages:
 * - One device WebSocket connection
 * - Multiple user WebSocket connections
 * - Bidirectional message forwarding between device and users
 *
 * Uses Hibernatable WebSockets for cost efficiency - the DO hibernates when
 * no messages are being exchanged, but WebSocket connections remain open.
 */

interface WebSocketMeta {
  type: 'device' | 'user';
  userId?: string;
  connectedAt: number;
}

export class DeviceProxy implements DurableObject {
  private state: DurableObjectState;
  private deviceSerial: string | null = null;
  private deviceWs: WebSocket | null = null;
  private userConnections: Map<string, WebSocket> = new Map(); // userId -> WebSocket

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore hibernated WebSocket connections
    this.state.getWebSockets().forEach((ws) => {
      const meta = this.state.getTags(ws);
      if (meta.includes('device')) {
        this.deviceWs = ws;
      } else {
        const userTag = meta.find((t) => t.startsWith('user:'));
        if (userTag) {
          const userId = userTag.split(':')[1];
          this.userConnections.set(userId, ws);
        }
      }
    });
  }

  /**
   * Handle HTTP requests to this Durable Object
   * - /device - Device WebSocket connection
   * - /user?userId={id} - User WebSocket connection
   * - /status - Get connection status (for debugging)
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      return this.handleStatus();
    }

    // Cloud -> device control message (e.g. {"type":"reregister"} after an unenroll)
    if (url.pathname === '/notify-device' && request.method === 'POST') {
      const text = await request.text();
      let delivered = 0;
      for (const ws of this.state.getWebSockets()) {
        if (this.state.getTags(ws).includes('device')) {
          try {
            ws.send(text);
            delivered++;
          } catch (error) {
            console.warn('[DeviceProxy] notify-device send failed:', error);
          }
        }
      }
      return new Response(JSON.stringify({ delivered }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check for WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    if (url.pathname === '/device') {
      return this.handleDeviceConnection(request, url);
    }

    if (url.pathname === '/user') {
      return this.handleUserConnection(request, url);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Handle device WebSocket connection
   */
  private handleDeviceConnection(request: Request, url: URL): Response {
    const serial = url.searchParams.get('serial');
    if (!serial) {
      return new Response('Missing serial parameter', { status: 400 });
    }

    // Only allow one device connection at a time
    if (this.deviceWs) {
      // Close existing connection
      try {
        this.deviceWs.close(1000, 'New device connection');
      } catch {
        // Ignore errors closing old connection
      }
    }

    this.deviceSerial = serial;

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket with hibernation enabled
    this.state.acceptWebSocket(server, ['device']);
    this.deviceWs = server;

    console.log(`[DeviceProxy ${serial}] Device connected`);

    // Notify connected users
    this.broadcastControlMessage({
      type: 'device_connected',
      serial_number: serial,
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle user WebSocket connection
   */
  private handleUserConnection(request: Request, url: URL): Response {
    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId parameter', { status: 400 });
    }

    // Check if user already has a connection
    const existingWs = this.userConnections.get(userId);
    if (existingWs) {
      try {
        existingWs.close(1000, 'New user connection');
      } catch {
        // Ignore errors closing old connection
      }
    }

    // Create WebSocket pair
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket with hibernation enabled
    this.state.acceptWebSocket(server, ['user', `user:${userId}`]);
    this.userConnections.set(userId, server);

    console.log(`[DeviceProxy ${this.deviceSerial}] User ${userId} connected`);

    // Send device status to user
    if (this.deviceWs) {
      this.sendControlMessage(server, {
        type: 'device_connected',
        serial_number: this.deviceSerial || 'unknown',
      });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Handle status request
   *
   * Note: We query getWebSockets() directly rather than relying on this.deviceWs
   * because the in-memory state may not be fully restored after hibernation
   * when woken by an HTTP request (vs a WebSocket message).
   */
  private handleStatus(): Response {
    // Check WebSockets directly from state to handle hibernation edge cases
    const allWebSockets = this.state.getWebSockets();
    let deviceConnected = false;
    let userCount = 0;
    const users: string[] = [];

    for (const ws of allWebSockets) {
      const tags = this.state.getTags(ws);
      if (tags.includes('device')) {
        deviceConnected = true;
      } else {
        const userTag = tags.find((t) => t.startsWith('user:'));
        if (userTag) {
          userCount++;
          users.push(userTag.split(':')[1]);
        }
      }
    }

    const status = {
      deviceSerial: this.deviceSerial,
      deviceConnected,
      userCount,
      users,
    };

    return new Response(JSON.stringify(status), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Hibernatable WebSocket message handler
   * Called when a message is received on any WebSocket
   */
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const tags = this.state.getTags(ws);
    const isDevice = tags.includes('device');

    if (isDevice) {
      // Message from device -> forward to all users
      this.forwardToUsers(message);
    } else {
      // Message from user -> forward to device
      this.forwardToDevice(message);
    }
  }

  /**
   * Hibernatable WebSocket close handler
   */
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean
  ): Promise<void> {
    const tags = this.state.getTags(ws);
    const isDevice = tags.includes('device');

    if (isDevice) {
      console.log(`[DeviceProxy ${this.deviceSerial}] Device disconnected: ${code} ${reason}`);
      this.deviceWs = null;

      // Notify users
      this.broadcastControlMessage({
        type: 'device_disconnected',
        serial_number: this.deviceSerial || 'unknown',
      });
    } else {
      const userTag = tags.find((t) => t.startsWith('user:'));
      if (userTag) {
        const userId = userTag.split(':')[1];
        console.log(`[DeviceProxy ${this.deviceSerial}] User ${userId} disconnected`);
        this.userConnections.delete(userId);
      }
    }
  }

  /**
   * Hibernatable WebSocket error handler
   */
  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error(`[DeviceProxy ${this.deviceSerial}] WebSocket error:`, error);
  }

  /**
   * Forward message from device to all connected users
   */
  private forwardToUsers(message: ArrayBuffer | string): void {
    for (const [userId, ws] of this.userConnections) {
      try {
        ws.send(message);
      } catch (err) {
        console.error(`[DeviceProxy] Failed to send to user ${userId}:`, err);
      }
    }
  }

  /**
   * Forward message from user to device
   */
  private forwardToDevice(message: ArrayBuffer | string): void {
    if (!this.deviceWs) {
      console.log(`[DeviceProxy ${this.deviceSerial}] No device connected, dropping message`);
      return;
    }

    try {
      this.deviceWs.send(message);
    } catch (err) {
      console.error(`[DeviceProxy] Failed to send to device:`, err);
    }
  }

  /**
   * Send control message to a specific WebSocket
   */
  private sendControlMessage(ws: WebSocket, message: WsControlMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      console.error(`[DeviceProxy] Failed to send control message:`, err);
    }
  }

  /**
   * Broadcast control message to all user WebSockets
   */
  private broadcastControlMessage(message: WsControlMessage): void {
    const json = JSON.stringify(message);
    for (const [userId, ws] of this.userConnections) {
      try {
        ws.send(json);
      } catch (err) {
        console.error(`[DeviceProxy] Failed to broadcast to user ${userId}:`, err);
      }
    }
  }
}
