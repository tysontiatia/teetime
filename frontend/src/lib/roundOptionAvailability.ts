import type { TeeTime } from '../types';

/** Live inventory vs a frozen round option. */
export type OptionAvailability = 'checking' | 'available' | 'unavailable' | 'unknown';

/** Minute-precision key so ISO timezone variants still match. */
export function teeInstantMinute(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.NaN;
  return Math.floor(t / 60_000);
}

/** True when a live open slot matches this option’s start (and holes). */
export function isOptionStillOpen(
  option: { starts_at: string | null; holes: number },
  liveTimes: TeeTime[],
): boolean {
  if (!option.starts_at) return false;
  const want = teeInstantMinute(option.starts_at);
  if (!Number.isFinite(want)) return false;
  const holes = option.holes === 9 ? 9 : 18;
  return liveTimes.some((t) => t.holes === holes && teeInstantMinute(t.startsAt) === want);
}

export function clampPlayers(n: number | null | undefined): 1 | 2 | 3 | 4 {
  const p = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 2;
  if (p <= 1) return 1;
  if (p === 2) return 2;
  if (p === 3) return 3;
  return 4;
}

export function clampHoles(n: number | null | undefined): 9 | 18 {
  return n === 9 ? 9 : 18;
}
