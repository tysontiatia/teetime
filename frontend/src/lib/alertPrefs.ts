/** Shared helpers for tee-time alert preferences (create + account edit). */

import { formatDateLong, formatDateShort, toYmd } from './time';

export type AlertTimeWindow = 'any' | 'morning' | 'afternoon' | 'evening';
export type AlertScheduleMode = 'specific' | 'weekly';

export type AlertScheduleValue = {
  mode: AlertScheduleMode;
  targetDate: string;
  dayOfWeek: string;
  timeWindow: AlertTimeWindow;
  players: 1 | 2 | 3 | 4;
};

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
export const ALERT_DOW_PLURAL = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
] as const;
export const ALERT_WINDOW_OPTIONS: { value: AlertTimeWindow; label: string }[] = [
  { value: 'any', label: 'All day' },
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Twilight' },
];

export function dowKeyFromIndex(i: number): string {
  return ALERT_DOW_KEYS[i] ?? 'sat';
}

export function dowKeyFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(y!, (m ?? 1) - 1, d ?? 1).getDay();
  return ALERT_DOW_KEYS[day] ?? 'sat';
}

/** Next calendar date on or after `fromYmd` that falls on `dowIndex` (0 = Sun). */
export function nextYmdForDow(fromYmd: string, dowIndex: number): string {
  const [y, m, d] = fromYmd.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const current = dt.getDay();
  const delta = (((dowIndex % 7) + 7) % 7 - current + 7) % 7;
  dt.setDate(dt.getDate() + delta);
  return toYmd(dt);
}

export function scheduleWithMode(
  value: AlertScheduleValue,
  mode: AlertScheduleMode,
  todayYmd: string,
): AlertScheduleValue {
  if (mode === value.mode) return value;
  if (mode === 'weekly') {
    return { ...value, mode, dayOfWeek: dowKeyFromYmd(value.targetDate) };
  }
  return {
    ...value,
    mode,
    targetDate: nextYmdForDow(todayYmd, ALERT_DOW_MAP[value.dayOfWeek] ?? 6),
  };
}

export type AlertDraftSummary = {
  kind: 'one-time' | 'weekly';
  title: string;
  scheduleLine: string;
  filtersLine: string;
  helperLine: string;
  summaryLine: string;
};

export function describeAlertDraft(value: AlertScheduleValue): AlertDraftSummary {
  const playersLabel = `${value.players} player${value.players !== 1 ? 's' : ''}`;
  const filtersLine = `${windowLabel(value.timeWindow)} · ${playersLabel}`;

  if (value.mode === 'specific') {
    const scheduleLine = formatDateLong(value.targetDate);
    return {
      kind: 'one-time',
      title: 'Your one-time Alert',
      scheduleLine,
      filtersLine,
      helperLine: 'We’ll email you if a matching time opens on this date.',
      summaryLine: `One-time · ${formatDateShort(value.targetDate)} · ${filtersLine}`,
    };
  }

  const dow = ALERT_DOW_MAP[value.dayOfWeek] ?? 6;
  const scheduleLine = ALERT_DOW_PLURAL[dow] ?? 'Weekly';
  return {
    kind: 'weekly',
    title: 'Your weekly Alert',
    scheduleLine,
    filtersLine,
    helperLine: 'We’ll watch this weekday for the next 14 days.',
    summaryLine: `Weekly · ${scheduleLine} · ${filtersLine}`,
  };
}
