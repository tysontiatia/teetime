import type { TimeOfDayPreset } from '../types';
import { DEFAULT_TEE_TIMEZONE, UTAH_TEE_TIMEZONE } from './teeTimeInstant';

export { UTAH_TEE_TIMEZONE, DEFAULT_TEE_TIMEZONE };

export function toYmd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar YYYY-MM-DD in a timezone for an ISO instant (default Mountain). */
export function ymdInTimeZone(iso: string, timeZone: string = DEFAULT_TEE_TIMEZONE): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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

/** @deprecated Prefer ymdInTimeZone — Utah/Mountain default. */
export function ymdInUtah(iso: string): string {
  return ymdInTimeZone(iso, UTAH_TEE_TIMEZONE);
}

/** Today’s calendar date in a timezone (default Mountain). */
export function todayYmd(timeZone: string = DEFAULT_TEE_TIMEZONE): string {
  return ymdInTimeZone(new Date().toISOString(), timeZone);
}

/** Today’s calendar date in Utah (America/Denver). */
export function todayYmdUtah(): string {
  return todayYmd(UTAH_TEE_TIMEZONE);
}

/**
 * Clamp a YYYY-MM-DD to today or later in `timeZone`.
 * Invalid/empty values snap to today. Allows “today” any time of day.
 */
export function clampDateToTodayOrLater(
  ymd: string,
  timeZone: string = DEFAULT_TEE_TIMEZONE,
): string {
  const today = todayYmd(timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return today;
  return ymd < today ? today : ymd;
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

/** Compact calendar label without weekday — better for dense mobile meta. */
export function formatDateCompact(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a tee-time instant in the course timezone (default Mountain). */
export function formatTime12h(iso: string, timeZone: string = DEFAULT_TEE_TIMEZONE) {
  const dt = new Date(iso);
  return dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone || DEFAULT_TEE_TIMEZONE,
  });
}

/** Hour 0–23 in a timezone for an instant (default Mountain). */
export function hourInTimeZone(iso: string, timeZone: string = DEFAULT_TEE_TIMEZONE): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || DEFAULT_TEE_TIMEZONE,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(iso)).find((p) => p.type === 'hour')?.value ?? NaN
  );
}

/** @deprecated Prefer hourInTimeZone — Utah/Mountain default. */
export function hourInUtah(iso: string): number {
  return hourInTimeZone(iso, UTAH_TEE_TIMEZONE);
}

export function minutesSince(ts: number | null) {
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

/** Human label for a slot that recently reopened (snapshot events). */
export function formatReopenedAgo(iso: string) {
  const mins = minutesSince(new Date(iso).getTime());
  if (mins == null || mins < 1) return 'Just opened';
  if (mins < 60) return `Opened ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 6) return `Opened ${hrs}h ago`;
  return 'Recently opened';
}

/** Compact reopen cue for finder chips — keeps spots/holes icons free. */
export function formatReopenedAgoShort(iso: string) {
  const mins = minutesSince(new Date(iso).getTime());
  if (mins == null || mins < 1) return 'Just in';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 6) return `${hrs}h ago`;
  return 'Reopened';
}

export function matchesPreset(
  startsAtIso: string,
  preset: TimeOfDayPreset,
  timeZone: string = DEFAULT_TEE_TIMEZONE,
) {
  if (preset === 'any') return true;
  const h = hourInTimeZone(startsAtIso, timeZone);
  if (!Number.isFinite(h)) return false;
  if (preset === 'morning') return h < 12;
  if (preset === 'afternoon') return h >= 12 && h < 16;
  return h >= 16;
}

