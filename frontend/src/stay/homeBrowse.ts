import { hourInTimeZone, shiftYmd, todayYmd } from '../lib/time';
import { DEFAULT_TEE_TIMEZONE } from '../lib/teeTimeInstant';
import { distanceFromAnchor, type FetchAnchor } from '../lib/timesFetchScope';
import type { Course, TeeTime, TimeOfDayPreset } from '../types';
import { nextSaturday, toYmd, visibleSlots, ymdToDate } from './stayTimes';

export type BrowseId = 'today' | 'tomorrow' | 'weekend' | 'next';

export const BROWSE_TABS: { id: BrowseId; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'next', label: 'Next weekend' },
];

export type HomeSearch = {
  place: string;
  radius: 15 | 25 | 50 | 'all';
  date: string;
  tod: TimeOfDayPreset;
  maxPrice?: number;
  opened?: boolean;
};

export type HomeRow = {
  id: string;
  title: string;
  courses: Course[];
  search: HomeSearch;
};

const DESERT_CITIES = new Set([
  'st george',
  'ivins',
  'hurricane',
  'santa clara',
  'phoenix',
  'scottsdale',
  'mesa',
  'tucson',
  'chandler',
  'gilbert',
  'las vegas',
  'henderson',
  'mesquite',
]);
const MOUNTAIN_CITIES = new Set(['park city', 'heber', 'heber city', 'midway', 'brian head']);

function placeCity(course: Course) {
  return (course.city || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
}

function isDesertCourse(course: Course) {
  const city = placeCity(course);
  if (city === 'washington') return (course.state || '').toUpperCase() === 'UT';
  return DESERT_CITIES.has(city);
}

function isMountainCourse(course: Course) {
  return MOUNTAIN_CITIES.has(placeCity(course));
}

/** Today, until Thursday evening. Thursday evening through Saturday, the coming Saturday. */
export function defaultBrowseId(now = new Date()): BrowseId {
  const ymd = todayYmd();
  const hour = hourInTimeZone(now.toISOString(), DEFAULT_TEE_TIMEZONE);
  const day = ymdToDate(ymd).getDay();
  if (day === 6 || day === 5 || (day === 4 && hour >= 17)) return 'weekend';
  return 'today';
}

export function comingSaturdayYmd(today = todayYmd()) {
  return toYmd(nextSaturday(ymdToDate(today)));
}

export function ymdForBrowse(id: BrowseId, today = todayYmd()) {
  if (id === 'today') return today;
  if (id === 'tomorrow') return shiftYmd(today, 1);
  const saturday = comingSaturdayYmd(today);
  if (id === 'weekend') return saturday;
  return shiftYmd(saturday, 7);
}

function dayPhrase(ymd: string, today: string) {
  if (ymd === today) return 'today';
  if (ymd === shiftYmd(today, 1)) return 'tomorrow';
  const [y, m, d] = ymd.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const delta = Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(ty!, tm! - 1, td!)) / 86400000);
  const weekday = ymdToDate(ymd).toLocaleDateString('en-US', { weekday: 'long' });
  if (delta >= 0 && delta < 7) return weekday;
  return ymdToDate(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function miles(course: Course, anchor: FetchAnchor) {
  return distanceFromAnchor(course, anchor);
}

function withPhotos(list: Course[]) {
  const photos = list.filter((course) => course.photoUrl);
  return photos.length >= 4 ? photos : list;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function minPrice(slots: TeeTime[]) {
  const prices = slots.map((tee) => tee.price).filter((price): price is number => typeof price === 'number');
  return prices.length ? Math.min(...prices) : null;
}

export function homeFetchCourses(courses: Course[], anchor: FetchAnchor, month: number) {
  const ranked = courses
    .map((course) => ({ course, distance: miles(course, anchor) }))
    .filter((row): row is { course: Course; distance: number } => row.distance != null)
    .sort((a, b) => a.distance - b.distance);
  const near = ranked.filter((row) => row.distance <= 25).slice(0, 32).map((row) => row.course);
  const drive = ranked
    .filter((row) => row.distance > 25 && row.distance <= 80)
    .sort((a, b) => (b.course.rating ?? 0) - (a.course.rating ?? 0))
    .slice(0, 16)
    .map((row) => row.course);
  const inSeason = month >= 5 && month <= 8 ? isMountainCourse : isDesertCourse;
  const season = courses.filter((course) => course.photoUrl && inSeason(course)).slice(0, 12);
  const seen = new Set<string>();
  const out: Course[] = [];
  for (const course of [...near, ...drive, ...season]) {
    if (seen.has(course.id)) continue;
    seen.add(course.id);
    out.push(course);
    if (out.length >= 48) break;
  }
  return out;
}

export function buildHomeRows(args: {
  courses: Course[];
  anchor: FetchAnchor;
  located: boolean;
  browseYmd: string;
  todayYmd: string;
  dealYmd: string;
  month: number;
  timesFor: (date: string, courseId: string) => TeeTime[];
}): HomeRow[] {
  const { courses, anchor, located, browseYmd, todayYmd: today, dealYmd, month, timesFor } = args;
  const nearName = located ? 'you' : 'Salt Lake City';
  const slotsOn = (course: Course, date: string, opts: { tod?: TimeOfDayPreset; maxPrice?: number } = {}) =>
    visibleSlots(timesFor(date, course.id), course.timezone || DEFAULT_TEE_TIMEZONE, opts);

  const ranked = courses
    .map((course) => ({ course, distance: miles(course, anchor) }))
    .filter((row): row is { course: Course; distance: number } => row.distance != null);

  const rows: HomeRow[] = [];
  const push = (row: HomeRow | null) => {
    if (row && row.courses.length > 0) rows.push(row);
  };

  const nearbyOpen = ranked
    .filter((row) => row.distance <= 25 && slotsOn(row.course, browseYmd).length > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12)
    .map((row) => row.course);
  const nearbyAny = ranked
    .filter((row) => row.distance <= 25 && row.course.photoUrl)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 12)
    .map((row) => row.course);
  const open = nearbyOpen.length > 0 ? withPhotos(nearbyOpen) : nearbyAny;
  push(open.length > 0 ? {
    id: 'open',
    title: nearbyOpen.length > 0 ? `Open ${dayPhrase(browseYmd, today)} near ${nearName}` : `Near ${nearName}`,
    courses: open,
    search: { place: 'Nearby', radius: 25, date: browseYmd, tod: 'any' },
  } : null);

  const topRated = ranked
    .filter((row) => {
      const rating = row.course.rating;
      const reviews = row.course.reviewCount ?? 0;
      return row.distance <= 25 && Boolean(row.course.photoUrl) && rating != null && rating >= 4.5 && reviews >= 20;
    })
    .sort((a, b) => (b.course.rating ?? 0) - (a.course.rating ?? 0) || (b.course.reviewCount ?? 0) - (a.course.reviewCount ?? 0) || a.distance - b.distance)
    .slice(0, 12)
    .map((row) => row.course);
  push(topRated.length >= 4 ? {
    id: 'rated',
    title: `Top rated near ${nearName}`,
    courses: topRated,
    search: { place: 'Nearby', radius: 25, date: browseYmd, tod: 'any' },
  } : null);

  const deals = withPhotos(
    ranked
      .filter((row) => row.distance <= 80 && slotsOn(row.course, dealYmd, { tod: 'morning', maxPrice: 40 }).length > 0)
      .sort((a, b) => {
        const price = (course: Course) => minPrice(slotsOn(course, dealYmd, { tod: 'morning', maxPrice: 40 })) ?? 999;
        return price(a.course) - price(b.course) || a.distance - b.distance;
      })
      .slice(0, 12)
      .map((row) => row.course),
  );
  push(deals.length > 0 ? {
    id: 'deals',
    title: 'Saturday morning under $40',
    courses: deals,
    search: { place: 'Nearby', radius: 50, date: dealYmd, tod: 'morning', maxPrice: 40 },
  } : null);

  const nearby = ranked.filter((row) => row.distance <= 25);
  const ratingBar = median(nearby.map((row) => row.course.rating).filter((rating): rating is number => rating != null));
  const priceBar = median(
    nearby
      .map((row) => minPrice(slotsOn(row.course, browseYmd)))
      .filter((price): price is number => price != null),
  );
  const drive = withPhotos(
    ranked
      .filter((row) => {
        if (row.distance <= 25 || row.distance > 80) return false;
        if (slotsOn(row.course, browseYmd).length === 0) return false;
        const rating = row.course.rating;
        const price = minPrice(slotsOn(row.course, browseYmd));
        const betterRated = rating != null && ratingBar != null && rating >= ratingBar + 0.3;
        const cheaper = price != null && priceBar != null && price <= priceBar - 8;
        return betterRated || cheaper;
      })
      .sort((a, b) => (b.course.rating ?? 0) - (a.course.rating ?? 0) || a.distance - b.distance)
      .slice(0, 12)
      .map((row) => row.course),
  );
  push(drive.length > 0 ? {
    id: 'drive',
    title: 'Worth the drive',
    courses: drive,
    search: { place: 'Nearby', radius: 50, date: browseYmd, tod: 'any' },
  } : null);

  const summer = month >= 5 && month <= 8;
  const seasonCourses = courses
    .filter((course) => course.photoUrl && (summer ? isMountainCourse(course) : isDesertCourse(course)))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, 12);
  push(seasonCourses.length >= 4 ? {
    id: 'season',
    title: summer ? 'Cooler rounds up high' : 'Still in season: St. George and Arizona',
    courses: seasonCourses,
    search: {
      place: summer ? 'Park City' : 'St. George',
      radius: 50,
      date: browseYmd,
      tod: 'any',
    },
  } : null);

  return rows;
}
