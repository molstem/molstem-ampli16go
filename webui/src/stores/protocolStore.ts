import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/** Wire order of the stages in `PROT:STAR`. */
export const STAGE_KEYS = ['intro', 'denature', 'anneal', 'extension', 'final'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export interface ProtocolStage {
  /** °C */
  temp: number;
  /** whole seconds */
  seconds: number;
}

export interface ProtocolInput {
  name: string;
  /** Repeats of denaturing + annealing + extension. */
  cycles: number;
  stages: Record<StageKey, ProtocolStage>;
}

export interface StoredProtocol extends ProtocolInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

interface ProtocolStoreState {
  protocols: StoredProtocol[];
}

interface ProtocolStoreActions {
  add: (input: ProtocolInput) => StoredProtocol;
  update: (id: string, input: ProtocolInput) => StoredProtocol | undefined;
  remove: (id: string) => void;
}

export const PROTOCOLS_STORAGE_KEY = 'molstem-protocols';

/** `crypto.randomUUID` is missing on plain-http origins (the ESP32 on the LAN). */
function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneInput(input: ProtocolInput): ProtocolInput {
  const stages = {} as Record<StageKey, ProtocolStage>;
  for (const key of STAGE_KEYS) {
    stages[key] = { temp: input.stages[key].temp, seconds: input.stages[key].seconds };
  }
  return { name: input.name, cycles: input.cycles, stages };
}

export const useProtocolStore = create<ProtocolStoreState & ProtocolStoreActions>()(
  persist(
    (set, get) => ({
      protocols: [],

      add: (input) => {
        const now = Date.now();
        const protocol: StoredProtocol = { ...cloneInput(input), id: newId(), createdAt: now, updatedAt: now };
        set((s) => ({ protocols: [protocol, ...s.protocols] }));
        return protocol;
      },

      update: (id, input) => {
        const existing = get().protocols.find((p) => p.id === id);
        if (!existing) return undefined;
        const updated: StoredProtocol = { ...cloneInput(input), id, createdAt: existing.createdAt, updatedAt: Date.now() };
        set((s) => ({ protocols: s.protocols.map((p) => (p.id === id ? updated : p)) }));
        return updated;
      },

      remove: (id) => set((s) => ({ protocols: s.protocols.filter((p) => p.id !== id) })),
    }),
    {
      name: PROTOCOLS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ protocols: s.protocols }),
    }
  )
);

/** Newest edited first. */
export function sortedProtocols(protocols: StoredProtocol[]): StoredProtocol[] {
  return [...protocols].sort((a, b) => b.updatedAt - a.updatedAt);
}
