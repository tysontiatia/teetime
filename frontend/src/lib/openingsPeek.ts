import type { TimeOfDayPreset } from '../types';
import { getWorkerBaseUrl } from './env';
import { shiftYmd } from './time';

export type OpenDay = { date: string; count: number };

const LOOKAHEAD_DAYS = 6;

/** Weekday name, or Tomorrow when the day is the one after the date being searched. */
export function openDayLabel(date: string, fromYmd: string): string {
  if (date === shiftYmd(fromYmd, 1)) return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { weekday: 'long' });
}

export function openDayButtonLabel(day: OpenDay, fromYmd: string): string {
  return `${openDayLabel(day.date, fromYmd)} has ${day.count}`;
}

/** Next dates that already have open tee times in the poller snapshot. */
export async function peekOpenDays(args: {
  fromYmd: string;
  slugs: string[];
  holes: 9 | 18 | 'any';
  players: number;
  tod: TimeOfDayPreset;
}): Promise<OpenDay[]> {
  const slugs = args.slugs.slice(0, 40);
  if (slugs.length === 0) return [];
  const dates = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) => shiftYmd(args.fromYmd, i + 1));
  const url = new URL(`${getWorkerBaseUrl()}/v1/openings-peek`);
  url.searchParams.set('dates', dates.join(','));
  url.searchParams.set('ids', slugs.join(','));
  url.searchParams.set('players', String(args.players));
  if (args.holes === 9 || args.holes === 18) url.searchParams.set('holes', String(args.holes));
  if (args.tod && args.tod !== 'any') url.searchParams.set('tod', args.tod);
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = (await res.json()) as { days?: OpenDay[] };
  return Array.isArray(data.days) ? data.days.filter((d) => d.date && d.count > 0) : [];
}
