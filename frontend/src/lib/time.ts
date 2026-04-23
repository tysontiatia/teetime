import type { TimeOfDayPreset } from '../types';

export function toYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDateShort(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime12h(iso: string) {
  const dt = new Date(iso);
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function minutesSince(ts: number | null) {
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

export function matchesPreset(startsAtIso: string, preset: TimeOfDayPreset) {
  if (preset === 'any') return true;
  const h = new Date(startsAtIso).getHours();
  if (preset === 'morning') return h < 12;
  if (preset === 'afternoon') return h >= 12 && h < 16;
  return h >= 16;
}

