/**
 * Device poller
 *
 * The device never streams anything unsolicited, so the UI polls it through
 * the SCPI client while a connection is up.
 *
 * Cadence (selected once per connection from the connection provider):
 *
 *   USB / local WebSocket ("fast" transports)
 *     - `HW?`         every 200 ms, USB only (feeds Temperatures + Hardware Monitor)
 *     - `STAT?`       every 1 s
 *     - `PROT:CYCL?`  every 1 s while RUNNING (pipelined with STAT?)
 *
 *   Cloud (app.molstem.com proxy, each request wakes the device link)
 *     - `STAT?`       every 60 s while not RUNNING
 *     - `PROT:CYCL?`  every 1 s while RUNNING; its temperature fields feed the
 *                     plots; on `ERR 201` (not running) we fall back to STAT?
 *     - never `HW?`, `LCD?` or `INP:*`
 *
 * `refreshNow()` forces one status round immediately (manual Refresh button).
 */

import { connectionService } from './connection';
import { scpiClient, ScpiError } from './scpiClient';
import { useSerialStore } from '../stores/serialStore';
import {
  useTelemetryStore,
  parseIdn,
  modelToDeviceMode,
  parseStat,
  parseCycle,
  parseHw,
  hwToPoint,
  type Transport,
} from '../stores/telemetryStore';

const IDN_TIMEOUT_MS = 2000;
const IDN_RETRY_MS = 2000;

const FAST_HW_INTERVAL_MS = 200;
const FAST_STAT_INTERVAL_MS = 1000;

const CLOUD_IDLE_INTERVAL_MS = 60_000;
const CLOUD_RUNNING_INTERVAL_MS = 1000;
const CLOUD_TIMEOUT_MS = 5000;

/** `HW?` feeds the temperature history; PROT:CYCL? only does when HW? is stale. */
const HW_FRESH_MS = 1500;

export function getTransport(): Transport {
  const provider = connectionService.getProvider();
  if (!provider) return null;
  if (provider.name === 'Cloud') return 'cloud';
  if (provider.type === 'serial') return 'usb';
  return 'local';
}

export function isCloudTransport(): boolean {
  return getTransport() === 'cloud';
}

class DevicePoller {
  private session = 0;
  private running = false;
  private transport: Transport = null;
  private timers = new Set<number>();
  private lastHwOk = 0;
  /** Set when the device answered `HW?` with ERR 100 (not available on this link). */
  private hwUnavailable = false;
  private statInFlight: Promise<void> | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.session += 1;
    this.transport = getTransport();
    this.lastHwOk = 0;
    this.hwUnavailable = false;

    const store = useTelemetryStore.getState();
    store.resetDevice();
    store.setTransport(this.transport);

    void this.identifyLoop(this.session);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.session += 1;
    for (const t of this.timers) window.clearTimeout(t);
    this.timers.clear();
    this.statInFlight = null;
    useTelemetryStore.getState().resetDevice();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Force one status round now (STAT?, PROT:CYCL? if running, HW? on fast links). */
  async refreshNow(): Promise<void> {
    if (!this.running) return;
    const session = this.session;
    const mode = useTelemetryStore.getState().deviceMode;
    if (mode === 'unknown') {
      await this.identifyOnce(session);
      return;
    }
    if (mode !== 'app') return;
    if (this.transport === 'cloud') {
      await this.cloudStatusRound(session);
    } else {
      await Promise.all([this.fastStatusRound(session), this.hwRound(session)]);
    }
  }

  // ---------------------------------------------------------------------------

  private alive(session: number): boolean {
    return this.running && session === this.session;
  }

  private schedule(session: number, delayMs: number, fn: () => void): void {
    if (!this.alive(session)) return;
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.alive(session)) fn();
    }, delayMs);
    this.timers.add(id);
  }

  private async identifyOnce(session: number): Promise<boolean> {
    try {
      const reply = await scpiClient.query('*IDN?', this.transport === 'cloud' ? CLOUD_TIMEOUT_MS : IDN_TIMEOUT_MS);
      if (!this.alive(session)) return false;
      const idn = parseIdn(reply);
      const store = useTelemetryStore.getState();
      if (!idn) {
        store.setDeviceMode('unknown', null);
        store.setLastPollError(`Unexpected *IDN? reply: ${reply}`);
        return false;
      }
      store.setDeviceMode(modelToDeviceMode(idn.model), { serial: idn.serial, version: idn.version });
      store.setLastPollError(null);
      return true;
    } catch (error) {
      if (!this.alive(session)) return false;
      useTelemetryStore.getState().setLastPollError(errorText(error));
      return false;
    }
  }

  private async identifyLoop(session: number): Promise<void> {
    const ok = await this.identifyOnce(session);
    if (!this.alive(session)) return;

    const mode = useTelemetryStore.getState().deviceMode;
    if (!ok || mode === 'unknown') {
      this.schedule(session, IDN_RETRY_MS, () => void this.identifyLoop(session));
      return;
    }

    if (mode === 'app') {
      if (this.transport === 'cloud') {
        void this.cloudLoop(session);
      } else {
        void this.fastStatLoop(session);
        void this.fastHwLoop(session);
      }
    }
    // bootloader / provisioning: nothing to poll; the Firmware Update page and
    // the provisioning tools own the link.
  }

  // --- USB / local -----------------------------------------------------------

  private async fastStatLoop(session: number): Promise<void> {
    await this.fastStatusRound(session);
    this.schedule(session, FAST_STAT_INTERVAL_MS, () => void this.fastStatLoop(session));
  }

  private async fastHwLoop(session: number): Promise<void> {
    await this.hwRound(session);
    if (this.hwUnavailable) return;
    this.schedule(session, FAST_HW_INTERVAL_MS, () => void this.fastHwLoop(session));
  }

  private fastStatusRound(session: number): Promise<void> {
    if (this.statInFlight) return this.statInFlight;
    const p = (async () => {
      const store = useTelemetryStore.getState();
      const wasRunning = store.state === 'RUNNING';
      const lines = wasRunning ? ['STAT?', 'PROT:CYCL?'] : ['STAT?'];
      const [statP, cyclP] = scpiClient.sendBatch(lines);

      try {
        const stat = await statP;
        if (!this.alive(session)) return;
        this.applyStat(stat);
      } catch (error) {
        if (!this.alive(session)) return;
        store.setLastPollError(errorText(error));
      }

      if (cyclP) {
        try {
          const cycl = await cyclP;
          if (!this.alive(session)) return;
          this.applyCycle(cycl);
        } catch (error) {
          if (!this.alive(session)) return;
          store.setLastPollError(errorText(error));
        }
      }

      // Just started running: fetch the first cycle snapshot right away.
      const now = useTelemetryStore.getState();
      if (!wasRunning && now.state === 'RUNNING') {
        try {
          const cycl = await scpiClient.send('PROT:CYCL?');
          if (this.alive(session)) this.applyCycle(cycl);
        } catch {
          /* next round will retry */
        }
      }
    })().finally(() => {
      this.statInFlight = null;
    });
    this.statInFlight = p;
    return p;
  }

  private async hwRound(session: number): Promise<void> {
    if (this.transport !== 'usb' || this.hwUnavailable) return;   // HW? is USB-only
    try {
      const reply = await scpiClient.query('HW?');
      if (!this.alive(session)) return;
      const t = Date.now();
      const hw = parseHw(reply);
      const store = useTelemetryStore.getState();
      store.setHw(hw, t);
      store.appendHw(hwToPoint(hw, t));
      if (Number.isFinite(hw.pelt_t) && Number.isFinite(hw.lid_t)) {
        this.lastHwOk = t;
        store.appendTemperature(hw.pelt_t, hw.lid_t, t);
      }
    } catch (error) {
      if (!this.alive(session)) return;
      if (error instanceof ScpiError && error.code === 100) {
        // Not available on this transport; stop asking (PROT:CYCL? feeds the plots instead).
        this.hwUnavailable = true;
        this.lastHwOk = 0;
        return;
      }
      useTelemetryStore.getState().setLastPollError(errorText(error));
    }
  }

  // --- Cloud -----------------------------------------------------------------

  private async cloudLoop(session: number): Promise<void> {
    await this.cloudStatusRound(session);
    if (!this.alive(session)) return;
    const running = useTelemetryStore.getState().state === 'RUNNING';
    this.schedule(session, running ? CLOUD_RUNNING_INTERVAL_MS : CLOUD_IDLE_INTERVAL_MS, () =>
      void this.cloudLoop(session)
    );
  }

  private cloudStatusRound(session: number): Promise<void> {
    if (this.statInFlight) return this.statInFlight;
    const p = (async () => {
      const store = useTelemetryStore.getState();
      if (store.state === 'RUNNING') {
        try {
          const cycl = await scpiClient.query('PROT:CYCL?', CLOUD_TIMEOUT_MS);
          if (!this.alive(session)) return;
          this.applyCycle(cycl);
          return;
        } catch (error) {
          if (!this.alive(session)) return;
          if (!(error instanceof ScpiError && error.code === 201)) {
            store.setLastPollError(errorText(error));
            return;
          }
          // ERR 201: the run ended; fall through to STAT? to learn the new state.
        }
      }
      try {
        const stat = await scpiClient.query('STAT?', CLOUD_TIMEOUT_MS);
        if (!this.alive(session)) return;
        this.applyStat(stat);
        if (useTelemetryStore.getState().state === 'RUNNING') {
          const cycl = await scpiClient.query('PROT:CYCL?', CLOUD_TIMEOUT_MS);
          if (this.alive(session)) this.applyCycle(cycl);
        }
      } catch (error) {
        if (!this.alive(session)) return;
        store.setLastPollError(errorText(error));
      }
    })().finally(() => {
      this.statInFlight = null;
    });
    this.statInFlight = p;
    return p;
  }

  // --- shared ----------------------------------------------------------------

  private applyStat(reply: string): void {
    const store = useTelemetryStore.getState();
    const state = parseStat(reply);
    if (state === null) {
      store.setLastPollError(`Unexpected STAT? reply: ${reply}`);
      return;
    }
    store.setState(state);
    store.setLastPollError(null);
  }

  private applyCycle(reply: string): void {
    const store = useTelemetryStore.getState();
    const t = Date.now();
    const cycle = parseCycle(reply, t);
    if (!cycle) {
      if (reply.toUpperCase().startsWith('ERR')) {
        // ERR 201: not running any more; the next STAT? sorts the state out.
        if (store.state === 'RUNNING' && /^ERR\s+201/i.test(reply)) store.setState(null);
      } else {
        store.setLastPollError(`Unexpected PROT:CYCL? reply: ${reply}`);
      }
      return;
    }
    store.setCycle(cycle);
    store.setLastPollError(null);
    if (t - this.lastHwOk > HW_FRESH_MS) {
      store.appendTemperature(cycle.peltierT, cycle.lidT, t);
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof ScpiError) return `ERR ${error.code}${error.msg ? ` ${error.msg}` : ''}`;
  if (error instanceof Error) return error.message;
  return String(error);
}

export const devicePoller = new DevicePoller();

// Follow the connection state: start on connect, stop on disconnect.
useSerialStore.subscribe((state, prev) => {
  if (state.isConnected && !prev.isConnected) {
    devicePoller.start();
  } else if (!state.isConnected && prev.isConnected) {
    devicePoller.stop();
  }
});
if (useSerialStore.getState().isConnected) {
  devicePoller.start();
}
