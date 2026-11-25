import type { RemainingInfo } from '../stores/telemetryStore';

/** `INTRO_DENATURING` → `Intro denaturing` */
export function humanizePhase(phase: string): string {
  const words = phase.toLowerCase().split('_').filter(Boolean);
  if (words.length === 0) return phase;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ' ' + words.slice(1).join(' ') : '');
}

/** `mm:ss`, or `h:mm:ss` for runs longer than an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

export function formatRemaining(remaining: RemainingInfo): string {
  switch (remaining) {
    case 'HEATING_LID':
      return 'Heating lid';
    case 'HEATING':
      return 'Heating';
    case 'COOLING':
      return 'Cooling';
    default:
      return formatDuration(remaining);
  }
}

export function formatTemp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} °C`;
}

/** Open a URL in the system browser under Electron, otherwise in a new tab. */
export function openExternal(url: string): void {
  const electronAPI = (window as unknown as { electronAPI?: { isElectron?: boolean; openExternal?: (u: string) => void } })
    .electronAPI;
  if (electronAPI?.isElectron && electronAPI.openExternal) {
    electronAPI.openExternal(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
