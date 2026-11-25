import { create } from 'zustand';

/** What answered `*IDN?`. */
export type DeviceMode = 'unknown' | 'app' | 'bootloader' | 'provisioning';

/** Reply of `STAT?`. */
export type DeviceState = 'IDLE' | 'RUNNING' | 'BUSY' | null;

/** Which link the poller is using (drives the polling cadence). */
export type Transport = 'usb' | 'local' | 'cloud' | null;

export interface DeviceIdentity {
  serial: string;
  version: string;
}

export type ProtocolPhase =
  | 'LID_PREHEAT'
  | 'INTRO_DENATURING'
  | 'DENATURING'
  | 'ANNEALING'
  | 'EXTENSION'
  | 'FINAL_EXTENSION'
  | 'COMPLETED'
  | 'ABORTING'
  | string;

export type RemainingInfo = number | 'HEATING_LID' | 'HEATING' | 'COOLING';

/** Parsed `PROT:CYCL?` reply. */
export interface CycleInfo {
  phase: ProtocolPhase;
  cycle: number;
  totalCycles: number;
  remaining: RemainingInfo;
  peltierT: number;
  peltierTarget: number | null;
  lidT: number;
  lidTarget: number | null;
  elapsedS: number;
  totalS: number;
  timestamp: number;
}

export interface TemperaturePoint {
  t: number;
  peltier: number;
  lid: number;
}

/** One `HW?` sample, mapped to named fields (null when the key was absent). */
export interface HwPoint {
  t: number;
  peltierCurrent: number | null;
  peltierTemp: number | null;
  peltierTempTarget: number | null;
  peltierCurrentTarget: number | null;
  lidCurrent: number | null;
  lidTemp: number | null;
  lidTempTarget: number | null;
  hbridgeVoltageTarget: number | null;
  hbridgeDuty: number | null;
  pidP: number | null;
  pidI: number | null;
  pidD: number | null;
}

/** 60 s window at the 5 Hz `HW?` cadence. */
const TEMP_RECENT_WINDOW_MS = 60_000;
const TEMP_RECENT_MAX_POINTS = 300;
/** Full-run history for the Current Protocol plot (~5.5 h at 5 Hz). */
const TEMP_HISTORY_MAX_POINTS = 100_000;
/** Same cap as the legacy DEBUG> parser. */
const HW_HISTORY_MAX_POINTS = 600;

interface TelemetryState {
  transport: Transport;
  deviceMode: DeviceMode;
  identity: DeviceIdentity | null;
  state: DeviceState;
  cycle: CycleInfo | null;
  hw: Record<string, number>;
  hwTimestamp: number | null;
  lastPollError: string | null;
  /** Rolling 60 s window (Temperatures panel). */
  temperatureRecent: TemperaturePoint[];
  /** Whole current run (Current Protocol panel). Cleared when a run starts. */
  temperatureHistory: TemperaturePoint[];
  hwHistory: HwPoint[];
}

interface TelemetryActions {
  setTransport: (transport: Transport) => void;
  setDeviceMode: (mode: DeviceMode, identity?: DeviceIdentity | null) => void;
  setState: (state: DeviceState) => void;
  setCycle: (cycle: CycleInfo | null) => void;
  setHw: (hw: Record<string, number>, timestamp: number) => void;
  setLastPollError: (error: string | null) => void;
  appendTemperature: (peltier: number, lid: number, t?: number) => void;
  appendHw: (point: HwPoint) => void;
  clearHistory: () => void;
  /** Forget the device (mode, identity, state, hw) but keep the plot histories. */
  resetDevice: () => void;
  reset: () => void;
}

const initialState: TelemetryState = {
  transport: null,
  deviceMode: 'unknown',
  identity: null,
  state: null,
  cycle: null,
  hw: {},
  hwTimestamp: null,
  lastPollError: null,
  temperatureRecent: [],
  temperatureHistory: [],
  hwHistory: [],
};

export const useTelemetryStore = create<TelemetryState & TelemetryActions>((set) => ({
  ...initialState,

  setTransport: (transport) => set({ transport }),

  setDeviceMode: (deviceMode, identity) =>
    set((s) => ({ deviceMode, identity: identity === undefined ? s.identity : identity })),

  setState: (state) =>
    set((s) => {
      // A new run starts: the Current Protocol plot shows this run only.
      if (state === 'RUNNING' && s.state !== 'RUNNING') {
        return { state, temperatureHistory: [] };
      }
      if (state !== 'RUNNING' && s.cycle !== null) {
        return { state, cycle: null };
      }
      return { state };
    }),

  setCycle: (cycle) => set({ cycle }),

  setHw: (hw, timestamp) => set({ hw, hwTimestamp: timestamp }),

  setLastPollError: (lastPollError) => set({ lastPollError }),

  appendTemperature: (peltier, lid, t = Date.now()) =>
    set((s) => {
      const point: TemperaturePoint = { t, peltier, lid };

      let recent = [...s.temperatureRecent, point];
      const cutoff = t - TEMP_RECENT_WINDOW_MS;
      let drop = 0;
      while (drop < recent.length - 1 && recent[drop].t < cutoff) drop++;
      if (drop > 0) recent = recent.slice(drop);
      if (recent.length > TEMP_RECENT_MAX_POINTS) recent = recent.slice(-TEMP_RECENT_MAX_POINTS);

      let history = [...s.temperatureHistory, point];
      if (history.length > TEMP_HISTORY_MAX_POINTS) history = history.slice(-TEMP_HISTORY_MAX_POINTS);

      return { temperatureRecent: recent, temperatureHistory: history };
    }),

  appendHw: (point) =>
    set((s) => {
      let hwHistory = [...s.hwHistory, point];
      if (hwHistory.length > HW_HISTORY_MAX_POINTS) hwHistory = hwHistory.slice(-HW_HISTORY_MAX_POINTS);
      return { hwHistory };
    }),

  clearHistory: () => set({ temperatureRecent: [], temperatureHistory: [], hwHistory: [] }),

  resetDevice: () =>
    set({
      transport: null,
      deviceMode: 'unknown',
      identity: null,
      state: null,
      cycle: null,
      hw: {},
      hwTimestamp: null,
      lastPollError: null,
    }),

  reset: () => set(initialState),
}));

// ---------------------------------------------------------------------------
// Reply parsers (pure, exported for reuse/tests)
// ---------------------------------------------------------------------------

/** `molstem,<model>,<serial>,<version>` */
export function parseIdn(line: string): { model: string; serial: string; version: string } | null {
  const parts = line.split(',').map((p) => p.trim());
  if (parts.length < 2 || parts[0].toLowerCase() !== 'molstem') return null;
  return { model: parts[1], serial: parts[2] ?? '', version: parts[3] ?? '' };
}

export function modelToDeviceMode(model: string): DeviceMode {
  switch (model.toLowerCase()) {
    case 'thermocycler':
      return 'app';
    case 'thermocycler-bootloader':
      return 'bootloader';
    case 'thermocycler-provisioning':
      return 'provisioning';
    default:
      return 'unknown';
  }
}

export function parseStat(line: string): DeviceState {
  const v = line.trim().toUpperCase();
  return v === 'IDLE' || v === 'RUNNING' || v === 'BUSY' ? v : null;
}

const parseTarget = (v: string): number | null => {
  if (v.toUpperCase() === 'NONE') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * `<phase>,<cycle>,<total_cycles>,<remaining>,<peltierT>,<peltierTarget>,<lidT>,<lidTarget>,<elapsed_s>,<total_s>`
 */
export function parseCycle(line: string, timestamp = Date.now()): CycleInfo | null {
  const f = line.split(',').map((p) => p.trim());
  if (f.length < 10) return null;
  const remainingRaw = f[3].toUpperCase();
  const remaining: RemainingInfo =
    remainingRaw === 'HEATING_LID' || remainingRaw === 'HEATING' || remainingRaw === 'COOLING'
      ? remainingRaw
      : parseInt(f[3], 10);
  const peltierT = parseFloat(f[4]);
  const lidT = parseFloat(f[6]);
  if (!Number.isFinite(peltierT) || !Number.isFinite(lidT)) return null;
  return {
    phase: f[0].toUpperCase(),
    cycle: parseInt(f[1], 10) || 0,
    totalCycles: parseInt(f[2], 10) || 0,
    remaining: typeof remaining === 'number' && !Number.isFinite(remaining) ? 0 : remaining,
    peltierT,
    peltierTarget: parseTarget(f[5]),
    lidT,
    lidTarget: parseTarget(f[7]),
    elapsedS: parseInt(f[8], 10) || 0,
    totalS: parseInt(f[9], 10) || 0,
    timestamp,
  };
}

/** `key=value,key=value,…` → numeric map (non-numeric values are dropped). */
export function parseHw(line: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of line.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = parseFloat(pair.slice(eq + 1).trim());
    if (key && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

const pick = (hw: Record<string, number>, key: string): number | null =>
  key in hw ? hw[key] : null;

export function hwToPoint(hw: Record<string, number>, t: number): HwPoint {
  return {
    t,
    peltierCurrent: pick(hw, 'pelt_i'),
    peltierTemp: pick(hw, 'pelt_t'),
    peltierTempTarget: pick(hw, 'pelt_t_set'),
    peltierCurrentTarget: pick(hw, 'pelt_i_set'),
    lidCurrent: pick(hw, 'lid_i'),
    lidTemp: pick(hw, 'lid_t'),
    lidTempTarget: pick(hw, 'lid_t_set'),
    hbridgeVoltageTarget: pick(hw, 'hb_v_set'),
    hbridgeDuty: pick(hw, 'hb_duty'),
    pidP: pick(hw, 'pid_p'),
    pidI: pick(hw, 'pid_i'),
    pidD: pick(hw, 'pid_d'),
  };
}
