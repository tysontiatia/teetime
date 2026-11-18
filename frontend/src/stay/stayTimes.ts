import type { TimeOfDayPreset, TeeTime, WeatherPoint } from '../types';
import { formatTime12h, hourInTimeZone, matchesPreset } from '../lib/time';
import { DEFAULT_TEE_TIMEZONE } from '../lib/teeTimeInstant';
import { pickNearestHour } from '../lib/weather';
import { slotWeatherBits, weatherKindFromPrecip, type WeatherKind } from '../lib/weatherKind';

export type SlotSummary = {
  span: string;
  more: number;
  from?: number;
  slots: TeeTime[];
};

export function toYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** The coming Saturday, or today when today is Saturday. */
export function nextSaturday(from = new Date()) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  if (day !== 6) d.setDate(d.getDate() + (6 - day));
  return d;
}

export function saturdayOf(weekendStart: Date) {
  const d = new Date(weekendStart);
  d.setHours(0, 0, 0, 0);
  if (d.getDay() === 5) d.setDate(d.getDate() + 1);
  return d;
}

function clock(iso: string, tz: string) {
  return formatTime12h(iso, tz).replace(/\s*[AP]M$/i, '');
}

export function visibleSlots(
  times: TeeTime[],
  tz: string = DEFAULT_TEE_TIMEZONE,
  opts: { tod?: TimeOfDayPreset; beforeHour?: number; maxPrice?: number; holes?: 9 | 18 | 'any' } = {},
) {
  const tod = opts.tod ?? 'any';
  return times
    .filter((tee) => {
      if (opts.holes && opts.holes !== 'any' && tee.holes !== opts.holes) return false;
      if (!matchesPreset(tee.startsAt, tod, tz)) return false;
      if (opts.beforeHour != null && hourInTimeZone(tee.startsAt, tz) >= opts.beforeHour) return false;
      if (opts.maxPrice != null && (tee.price == null || tee.price > opts.maxPrice)) return false;
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.holes - b.holes);
}

/**
 * Two rows that read as the same tee time (clock, holes, price) are one choice.
 * Keeps the row with more open spots.
 */
export function collapseIdenticalSlots(slots: TeeTime[], tz: string = DEFAULT_TEE_TIMEZONE): TeeTime[] {
  const kept = new Map<string, TeeTime>();
  for (const tee of slots) {
    const key = `${formatTime12h(tee.startsAt, tz)}|${tee.holes}|${tee.price ?? ''}`;
    const prev = kept.get(key);
    if (!prev || (tee.spots ?? 0) > (prev.spots ?? 0)) kept.set(key, tee);
  }
  return [...kept.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.holes - b.holes);
}

export type SheetWeather = {
  kind: WeatherKind;
  precip: number;
  label: string;
};

/** One line for the sheet when every visible time shares the same sky and a tight temperature range. */
export function sheetWeatherSummary(
  slots: TeeTime[],
  points: WeatherPoint[] | null | undefined,
): SheetWeather | null {
  if (!points?.length || slots.length === 0) return null;
  const rows = slots.map((tee) => {
    const bits = slotWeatherBits(pickNearestHour(points, tee.startsAt));
    if (!bits) return null;
    return { temp: Number.parseInt(bits.temp, 10), rainPct: bits.rainPct, kind: weatherKindFromPrecip(bits.rainPct) };
  });
  if (rows.some((row) => !row)) return null;
  const known = rows.filter((row): row is NonNullable<typeof row> => row != null);
  const kind = known[0]?.kind;
  if (!kind || known.some((row) => row.kind !== kind)) return null;
  const temps = known.map((row) => row.temp);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const tempLabel = min === max ? `${min}°` : `${min}–${max}°`;
  const precip = Math.max(...known.map((row) => row.rainPct));
  if (kind === 'rain') return { kind, precip, label: `Rain likely · ${tempLabel} · ${precip}%` };
  return { kind, precip, label: `Sunny · ${tempLabel}` };
}

export function summarizeSlots(slots: TeeTime[], tz: string = DEFAULT_TEE_TIMEZONE): SlotSummary | null {
  if (slots.length === 0) return null;
  const window = slots.slice(0, 3);
  const first = window[0]!;
  const last = window[window.length - 1]!;
  const prices = slots.map((tee) => tee.price).filter((price): price is number => typeof price === 'number');
  return {
    span: window.length > 1 ? `${clock(first.startsAt, tz)}–${clock(last.startsAt, tz)}` : clock(first.startsAt, tz),
    more: Math.max(0, slots.length - window.length),
    from: prices.length ? Math.min(...prices) : undefined,
    slots,
  };
}

export function splitDay(slots: TeeTime[], tz: string = DEFAULT_TEE_TIMEZONE) {
  const morning: TeeTime[] = [];
  const afternoon: TeeTime[] = [];
  for (const tee of slots) {
    const hour = hourInTimeZone(tee.startsAt, tz);
    if (hour < 12) morning.push(tee);
    else afternoon.push(tee);
  }
  return { morning, afternoon };
}
