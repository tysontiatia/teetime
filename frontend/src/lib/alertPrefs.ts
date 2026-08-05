/** Shared helpers for tee-time alert preferences (create + account edit). */

export type AlertTimeWindow = 'any' | 'morning' | 'afternoon' | 'evening';

export function windowToRange(w: AlertTimeWindow): { earliest: string; latest: string } {
  switch (w) {
    case 'morning':
      return { earliest: '05:00:00', latest: '11:59:00' };
    case 'afternoon':
      return { earliest: '12:00:00', latest: '16:59:00' };
    case 'evening':
      return { earliest: '17:00:00', latest: '21:00:00' };
    default:
      return { earliest: '00:00:00', latest: '23:59:00' };
  }
}

/** Best-effort reverse of windowToRange from stored HH:MM(:SS) bounds. */
export function rangeToWindow(earliest: string, latest: string): AlertTimeWindow {
  const e = (earliest || '').slice(0, 5);
  const l = (latest || '').slice(0, 5);
  if (e === '05:00' && l.startsWith('11:59')) return 'morning';
  if (e === '12:00' && l.startsWith('16:59')) return 'afternoon';
  if (e === '17:00' && l.startsWith('21:00')) return 'evening';
  return 'any';
}

export function windowLabel(w: AlertTimeWindow): string {
  switch (w) {
    case 'morning':
      return 'Morning';
    case 'afternoon':
      return 'Afternoon';
    case 'evening':
      return 'Twilight';
    default:
      return 'All day';
  }
}

export function clampAlertPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

export const ALERT_DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export const ALERT_DOW_MAP: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
export const ALERT_DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function dowKeyFromIndex(i: number): string {
  return ALERT_DOW_KEYS[i] ?? 'sat';
}
