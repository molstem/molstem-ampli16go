/**
 * SCPI client
 *
 * The device (STM32 application, STM32 bootloader and ESP32 provisioning mode)
 * speaks one line based request/response protocol over USB CDC, the local
 * WebSocket and the cloud device socket. See docs/serial-api.md.
 *
 * - Every non-empty request produces exactly one reply line.
 * - Requests may be pipelined; replies arrive in order.
 * - Nothing is sent unsolicited (except the legacy bootloader banner, which is
 *   filtered out here and forwarded to the unsolicited listeners).
 *
 * All traffic MUST go through this client: a raw write would desynchronise the
 * FIFO of pending requests.
 */

import { serialService } from './serialService';
import { useSerialStore } from '../stores/serialStore';

export interface ScpiErrorInfo {
  code: number;
  msg: string;
}

export class ScpiError extends Error {
  readonly code: number;
  readonly msg: string;
  readonly line: string;

  constructor(code: number, msg: string, line: string) {
    super(`ERR ${code}${msg ? `: ${msg}` : ''}`);
    this.name = 'ScpiError';
    this.code = code;
    this.msg = msg;
    this.line = line;
  }
}

export type TrafficDirection = 'tx' | 'rx';
/** `request` is the request line a received reply belongs to (undefined for tx / unsolicited). */
export type TrafficListener = (direction: TrafficDirection, line: string, request?: string) => void;
export type UnsolicitedListener = (line: string) => void;

interface Pending {
  request: string;
  timeoutMs: number;
  timer: number | null;
  resolve: (reply: string) => void;
  reject: (error: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 2000;

/** Lines the device may print on its own (never a reply). */
const NOISE_PATTERNS: RegExp[] = [/^BOOTLOADER:/i];

/**
 * Parse an `ERR <code>,"<message>"` line. Returns null when the line is not an error.
 */
export function parseErr(line: string): ScpiErrorInfo | null {
  const m = line.match(/^ERR\s+(\d+)(?:\s*,\s*"((?:[^"]|"")*)"|\s*,\s*(.*))?\s*$/i);
  if (!m) return null;
  const code = parseInt(m[1], 10);
  const msg = m[2] !== undefined ? m[2].replace(/""/g, '"') : (m[3] ?? '').trim();
  return { code, msg };
}

/**
 * Quote a string argument: wrap in double quotes, doubling embedded quotes.
 */
export function quoteArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

class ScpiClient {
  private pending: Pending[] = [];
  private carry = '';
  private unsolicitedListeners = new Set<UnsolicitedListener>();
  private trafficListeners = new Set<TrafficListener>();
  private started = false;

  /** Idempotent: hook into the connection layer and the connection store. */
  start(): void {
    if (this.started) return;
    this.started = true;

    // connectionService keeps the text callbacks across provider changes, so a
    // single subscription is enough for the whole application lifetime.
    serialService.onData((chunk) => this.handleChunk(chunk));
    serialService.onDisconnect(() => this.reset(new Error('Disconnected')));

    useSerialStore.subscribe((state, prev) => {
      if (prev.isConnected && !state.isConnected) {
        this.reset(new Error('Disconnected'));
      } else if (!prev.isConnected && state.isConnected) {
        // Fresh link: drop any partial line from the previous session.
        this.carry = '';
      }
    });
  }

  /** Number of requests still waiting for a reply. */
  pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Send one request line and resolve with the raw reply line (data, OK or ERR).
   */
  send(line: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
    return this.sendBatch([line], timeoutMs)[0];
  }

  /**
   * Send several request lines in a single write (pipelining). Returns one
   * promise per line, resolved in order with the raw reply lines.
   * `timeoutMs` may be a single value or one value per line.
   */
  sendBatch(lines: string[], timeoutMs: number | number[] = DEFAULT_TIMEOUT_MS): Promise<string>[] {
    const requests = lines.map((l) => l.replace(/[\r\n]+/g, '').trim());
    const entries: Pending[] = [];
    const promises: Promise<string>[] = [];

    requests.forEach((request, i) => {
      const t = Array.isArray(timeoutMs) ? (timeoutMs[i] ?? DEFAULT_TIMEOUT_MS) : timeoutMs;
      let entry!: Pending;
      const promise = new Promise<string>((resolve, reject) => {
        entry = { request, timeoutMs: t, timer: null, resolve, reject };
      });
      entries.push(entry);
      promises.push(promise);
    });

    if (requests.some((r) => r.length === 0)) {
      const err = new Error('Empty request line');
      entries.forEach((e) => e.reject(err));
      return promises;
    }

    if (!serialService.isConnected()) {
      const err = new Error('Not connected');
      entries.forEach((e) => e.reject(err));
      return promises;
    }

    this.pending.push(...entries);
    this.armHead();

    const payload = requests.map((r) => r + '\n').join('');
    requests.forEach((r) => this.emitTraffic('tx', r));

    serialService.write(payload).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      entries.forEach((e) => this.removePending(e, err));
    });

    return promises;
  }

  /**
   * Send a query; resolves with the data line, rejects with ScpiError on `ERR`.
   */
  async query(line: string, timeoutMs?: number): Promise<string> {
    const reply = await this.send(line, timeoutMs);
    const err = parseErr(reply);
    if (err) throw new ScpiError(err.code, err.msg, reply);
    return reply;
  }

  /**
   * Send a command; resolves with the `OK…` line, rejects otherwise.
   */
  async command(line: string, timeoutMs?: number): Promise<string> {
    const reply = await this.send(line, timeoutMs);
    if (/^OK(\s|$)/i.test(reply)) return reply;
    const err = parseErr(reply);
    if (err) throw new ScpiError(err.code, err.msg, reply);
    throw new Error(`Unexpected reply to ${line}: ${reply}`);
  }

  /** Lines that arrive while no request is pending. */
  onUnsolicited(cb: UnsolicitedListener): () => void {
    this.unsolicitedListeners.add(cb);
    return () => {
      this.unsolicitedListeners.delete(cb);
    };
  }

  /** Every line sent or received (for the raw console). */
  onTraffic(cb: TrafficListener): () => void {
    this.trafficListeners.add(cb);
    return () => {
      this.trafficListeners.delete(cb);
    };
  }

  /** Reject every pending request and clear the line buffer. */
  reset(reason: Error = new Error('SCPI client reset')): void {
    const entries = this.pending;
    this.pending = [];
    this.carry = '';
    for (const e of entries) {
      if (e.timer !== null) window.clearTimeout(e.timer);
      e.reject(reason);
    }
  }

  // ---------------------------------------------------------------------------

  private handleChunk(chunk: string): void {
    this.carry += chunk.replace(/\r/g, '');
    const lines = this.carry.split('\n');
    this.carry = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    if (NOISE_PATTERNS.some((re) => re.test(line))) {
      this.emitTraffic('rx', line);
      this.emitUnsolicited(line);
      return;
    }

    const head = this.pending.shift();
    this.emitTraffic('rx', line, head?.request);
    if (!head) {
      this.emitUnsolicited(line);
      return;
    }

    if (head.timer !== null) window.clearTimeout(head.timer);
    head.resolve(line);
    this.armHead();
  }

  /**
   * The timeout of a request only starts counting once it is at the head of
   * the FIFO (i.e. the device is working on it), so that pipelined lines queued
   * behind a slow request (bootloader erase) do not time out spuriously.
   */
  private armHead(): void {
    const head = this.pending[0];
    if (!head || head.timer !== null) return;
    head.timer = window.setTimeout(() => {
      head.timer = null;
      this.removePending(head, new Error(`Timeout waiting for reply to ${head.request}`));
    }, head.timeoutMs);
  }

  private removePending(entry: Pending, error: Error): void {
    const idx = this.pending.indexOf(entry);
    if (idx >= 0) this.pending.splice(idx, 1);
    if (entry.timer !== null) {
      window.clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.reject(error);
    this.armHead();
  }

  private emitUnsolicited(line: string): void {
    this.unsolicitedListeners.forEach((cb) => {
      try {
        cb(line);
      } catch (e) {
        console.error('unsolicited listener failed', e);
      }
    });
  }

  private emitTraffic(direction: TrafficDirection, line: string, request?: string): void {
    this.trafficListeners.forEach((cb) => {
      try {
        cb(direction, line, request);
      } catch (e) {
        console.error('traffic listener failed', e);
      }
    });
  }
}

export const scpiClient = new ScpiClient();
scpiClient.start();
