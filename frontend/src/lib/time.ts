import type { TimeOfDayPreset } from '../types';
import { UTAH_TEE_TIMEZONE } from './teeTimeInstant';

export function toYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar YYYY-MM-DD in Utah for an ISO instant (aligns plan date with tee sheets). */
export function ymdInUtah(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UTAH_TEE_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!y || !mo || !day) return toYmd(d);
  return `${y}-${mo}-${day}`;
}

/** Earliest calendar day (Utah) among tee-time instants — use as plan headline date. */
export function minYmdUtahFromIsoStarts(startsAtIsos: string[]): string {
  if (!startsAtIsos.length) return toYmd(new Date());
  let min = ymdInUtah(startsAtIsos[0]!);
  for (let i = 1; i < startsAtIsos.length; i++) {
    const y = ymdInUtah(startsAtIsos[i]!);
    if (y < min) min = y;
  }
  return min;
}

export function formatDateShort(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Format a tee-time instant in America/Denver (matches Utah booking sites). */
export function formatTime12h(iso: string) {
  const dt = new Date(iso);
  return dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: UTAH_TEE_TIMEZONE,
  });
}

/** Hour 0–23 in America/Denver for an instant (weather + tee alignment). */
export function hourInUtah(iso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: UTAH_TEE_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(iso)).find((p) => p.type === 'hour')?.value ?? NaN
  );
}

export function minutesSince(ts: number | null) {
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

export function matchesPreset(startsAtIso: string, preset: TimeOfDayPreset) {
  if (preset === 'any') return true;
  const h = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: UTAH_TEE_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(startsAtIso)).find((p) => p.type === 'hour')?.value ?? NaN
  );
  if (!Number.isFinite(h)) return false;
  if (preset === 'morning') return h < 12;
  if (preset === 'afternoon') return h >= 12 && h < 16;
  return h >= 16;
}

