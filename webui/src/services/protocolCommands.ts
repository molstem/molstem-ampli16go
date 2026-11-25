/**
 * Bio-protocol commands: validation against the device's own limits, the
 * `PROT:STAR` / `PROT:STOP` requests, and error wording for the UI.
 */

import { scpiClient, ScpiError, quoteArg } from './scpiClient';
import { devicePoller } from './devicePoller';
import { STAGE_KEYS, type ProtocolInput, type StageKey, type StoredProtocol } from '../stores/protocolStore';

/** Mirrors firmware/App/molstem/v2/pcr.cpp; the device answers ERR 104 outside these. */
export const LIMITS = {
  nameLen: 32,
  commentLen: 64,
  cycles: [1, 50] as const,
  temp: [20, 99] as const,
  seconds: {
    intro: [10, 600],
    denature: [1, 300],
    anneal: [5, 300],
    extension: [1, 300],
    final: [10, 300],
  } as Record<StageKey, readonly [number, number]>,
} as const;

export const STAGE_LABELS: Record<StageKey, string> = {
  intro: 'Intro denaturing',
  denature: 'Denaturing',
  anneal: 'Annealing',
  extension: 'Extension',
  final: 'Final extension',
};

/** Stages repeated `cycles` times; intro and final run once. */
export const CYCLED_STAGES: readonly StageKey[] = ['denature', 'anneal', 'extension'];

/** A typical three-step PCR so a first protocol can be started quickly. */
export const DEFAULT_PROTOCOL: ProtocolInput = {
  name: '',
  cycles: 30,
  stages: {
    intro: { temp: 95, seconds: 180 },
    denature: { temp: 95, seconds: 30 },
    anneal: { temp: 55, seconds: 30 },
    extension: { temp: 72, seconds: 60 },
    final: { temp: 72, seconds: 300 },
  },
};

/** Form state: everything as typed, validated on submit. */
export interface ProtocolDraft {
  name: string;
  cycles: string;
  stages: Record<StageKey, { temp: string; seconds: string }>;
}

export type DraftField = 'name' | 'cycles' | `${StageKey}.temp` | `${StageKey}.seconds`;

export function draftFromProtocol(p: ProtocolInput = DEFAULT_PROTOCOL): ProtocolDraft {
  const stages = {} as ProtocolDraft['stages'];
  for (const key of STAGE_KEYS) {
    stages[key] = { temp: String(p.stages[key].temp), seconds: String(p.stages[key].seconds) };
  }
  return { name: p.name, cycles: String(p.cycles), stages };
}

export type ValidationResult =
  | { ok: true; value: ProtocolInput }
  | { ok: false; error: string; field: DraftField };

export function validateDraft(d: ProtocolDraft): ValidationResult {
  const name = d.name.trim();
  if (!name) return { ok: false, error: 'Give the protocol a name', field: 'name' };
  if (name.length > LIMITS.nameLen) {
    return { ok: false, error: `Name must be at most ${LIMITS.nameLen} characters`, field: 'name' };
  }

  const cycles = Number(d.cycles.trim());
  if (!d.cycles.trim() || !Number.isInteger(cycles) || cycles < LIMITS.cycles[0] || cycles > LIMITS.cycles[1]) {
    return { ok: false, error: `Cycles must be a whole number from ${LIMITS.cycles[0]} to ${LIMITS.cycles[1]}`, field: 'cycles' };
  }

  const stages = {} as Record<StageKey, { temp: number; seconds: number }>;
  for (const key of STAGE_KEYS) {
    const label = STAGE_LABELS[key];
    const tempRaw = d.stages[key].temp.trim();
    const secRaw = d.stages[key].seconds.trim();
    const temp = Number(tempRaw);
    if (!tempRaw || !Number.isFinite(temp)) {
      return { ok: false, error: `${label}: temperature is required`, field: `${key}.temp` };
    }
    if (temp < LIMITS.temp[0] || temp > LIMITS.temp[1]) {
      return { ok: false, error: `${label}: temperature must be ${LIMITS.temp[0]}–${LIMITS.temp[1]} °C`, field: `${key}.temp` };
    }
    const seconds = Number(secRaw);
    const [minS, maxS] = LIMITS.seconds[key];
    if (!secRaw || !Number.isInteger(seconds)) {
      return { ok: false, error: `${label}: time must be a whole number of seconds`, field: `${key}.seconds` };
    }
    if (seconds < minS || seconds > maxS) {
      return { ok: false, error: `${label}: time must be ${minS}–${maxS} s`, field: `${key}.seconds` };
    }
    stages[key] = { temp: Math.round(temp * 10) / 10, seconds };
  }

  return { ok: true, value: { name, cycles, stages } };
}

/**
 * `PROT:STAR "<name>","<comment>",<cycles>,<introT>,<introS>,<denT>,<denS>,<annT>,<annS>,<extT>,<extS>,<finT>,<finS>`
 */
export function buildStartCommand(p: ProtocolInput, comment: string): string {
  const args: string[] = [quoteArg(p.name.trim()), quoteArg(comment.trim()), String(p.cycles)];
  for (const key of STAGE_KEYS) {
    args.push(String(p.stages[key].temp), String(p.stages[key].seconds));
  }
  return `PROT:STAR ${args.join(',')}`;
}

export function describeError(error: unknown): string {
  if (error instanceof ScpiError) return `ERR ${error.code}${error.msg ? ` "${error.msg}"` : ''}`;
  return error instanceof Error ? error.message : String(error);
}

/** Wording for a failed `PROT:STAR`. */
export function startErrorMessage(error: unknown): string {
  if (error instanceof ScpiError) {
    switch (error.code) {
      case 200:
        return 'The device is not idle. Check the device screen and try again.';
      case 202:
        return 'The device is busy. Finish the dialog on the device first.';
      case 104:
        return `A value is outside the range the device accepts${error.msg ? ` (${error.msg})` : ''}.`;
    }
  }
  return `Start failed: ${describeError(error)}`;
}

export async function startProtocol(p: StoredProtocol, comment: string): Promise<void> {
  await scpiClient.command(buildStartCommand(p, comment), 5000);
  void devicePoller.refreshNow();
}

export async function stopProtocol(): Promise<void> {
  await scpiClient.command('PROT:STOP', 5000);
  void devicePoller.refreshNow();
}

/** `30 cycles · 95/30 → 55/30 → 72/60` */
export function summarizeProtocol(p: ProtocolInput): string {
  const fmt = (key: StageKey) => `${p.stages[key].temp}/${p.stages[key].seconds}`;
  return `${p.cycles} cycles · ${CYCLED_STAGES.map(fmt).join(' → ')}`;
}
