import type { Course } from '../types';
import { coursePhotoUrl } from './coursePhotoUrl';
import { slugFromCourseName } from './courseSlug';
import { effectivePlatform, getPlatformCapability } from './platformRegistry';

/** One row from `public/courses.json` */
export type CourseRecord = {
  name: string;
  area: string;
  platform: string;
  booking_url: string;
  lat?: number;
  lng?: number;
  rating?: number;
  review_count?: number;
  address?: string;
  /** @deprecated Expired CDN URLs — use photo_reference + worker /place-photo instead. */
  photo_url?: string;
  /** Stable Google Places photo id — proxied via worker with GOOGLE_PLACES_KEY. */
  photo_reference?: string;
  schedule_id?: string;
  booking_class_id?: string;
  course_ids?: number[];
  golf_club_id?: string;
  golf_course_id?: string;
  club_id?: string;
  course_id?: string;
  affiliation_type_id?: string;
  /** Trutee public booking (City of St. George munis, etc.). */
  trutee_org_slug?: string;
  trutee_course_id?: string;
  /** GolfPay `_gshcid` / data-course-id (Barn = 1466). */
  golfpay_course_id?: string;
  /** Club Prophet Systems (CPS) Online Res — tenant subdomain + course id. */
  cps_tenant?: string;
  cps_course_id?: string;
  /** TeeItUp: numeric facility (query + deep link) + mongo courseId hash (poll mapping). */
  facility_id?: string;
  teeitup_course_id?: string;
  /** TeeItUp tenant alias (x-be-alias header). Derived from booking_url when omitted. */
  teeitup_alias?: string;
  /** Quick18 tenant subdomain (`papago.quick18.com` → `papago`). */
  quick18_tenant?: string;
  /** Optional Quick18 course id when one tenant hosts multiple tees (Grayhawk Talon vs Raptor). */
  quick18_course_id?: string;
  booking_window_days?: number;
  booking_opens_time?: string;
  timezone?: string;
  holes?: 9 | 18;
  par?: number;
  yardage?: number;
  walkability?: 'flat' | 'moderate' | 'hilly' | 'carts only';
  rate_notes?: string;
  twilight_discount?: boolean;
  rates_updated_at?: string;
  cancellation_policy?: string;
  editorial_note?: string;
  signature_hole?: string;
  history_blurb?: string;
  /** Course marketing site (distinct from platform booking_url). */
  website?: string;
  phone_number?: string;
  /** Google Places place_id for later Details enrich (no Places call at import). */
  google_place_id?: string;
  /**
   * Booking QA disposition.
   * - pending: still needs QA (default for stubs)
   * - ready: known platform + booking URL
   * - phone: open course, no online booking
   * - unsupported: online book exists, vendor not integrated yet
   * - private: members-only / country club (hidden from public Find)
   * - closed: not operational (hidden from public Find)
   */
  booking_status?: 'pending' | 'ready' | 'phone' | 'unsupported' | 'private' | 'closed';
  /** Free-text note (unsupported vendor name, closed reason, etc.). */
  booking_status_note?: string;
  poll_tier?: 'hot' | 'warm' | 'cold';
  booking_url_template?: string;
};

/** "Bear Lake (Garden City)" → { short: "Bear Lake", city: "Garden City" } */
export function parseCourseTitle(fullName: string): { short: string; city: string } {
  const m = fullName.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (m) return { short: m[1].trim(), city: m[2].trim() };
  return { short: fullName.trim(), city: '' };
}

/**
 * "305 W Pleasant View Dr, Ogden, UT 84414, USA" → "Ogden"
 * Also works for other US states (e.g. ", Boise, ID 83702").
 * Tolerates a missing comma before the state ("Eagle Mountain UT 84005").
 */
export function cityFromAddress(address?: string): string {
  if (!address) return '';
  const withZip = address.match(/,\s*([^,]+?),\s*[A-Z]{2}\s+\d{5}\b/i);
  if (withZip) return withZip[1]!.trim();
  const missingComma = address.match(/,\s*([^,]+?)\s+[A-Z]{2}\s+\d{5}\b/i);
  if (missingComma) return missingComma[1]!.trim();
  const stateOnly = address.match(/,\s*([^,]+?),\s*[A-Z]{2}\b/i);
  return stateOnly ? stateOnly[1]!.trim() : '';
}

/** "…, Eagle, ID 83616, USA" → "ID" (also "Eagle Mountain UT 84005"). */
export function stateFromAddress(address?: string): string {
  if (!address) return '';
  const m =
    address.match(/,\s*[^,]+?,\s*([A-Z]{2})\s+\d{5}\b/i) ||
    address.match(/,\s*[^,]+?\s+([A-Z]{2})\s+\d{5}\b/i) ||
    address.match(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/i);
  return m?.[1] ? m[1].toUpperCase() : '';
}

/** Infer state when address is thin — area / timezone hints for multi-state catalog. */
export function stateFromRecord(record: {
  address?: string;
  area?: string;
  timezone?: string;
}): string {
  const fromAddress = stateFromAddress(record.address);
  if (fromAddress) return fromAddress;
  const area = String(record.area || '').trim().toLowerCase();
  if (area.startsWith('idaho') || area.includes('idaho ·')) return 'ID';
  if (area.startsWith('arizona') || area.includes('arizona ·')) return 'AZ';
  if (area.startsWith('wyoming') || area.includes('wyoming ·')) return 'WY';
  const tz = String(record.timezone || '').trim();
  if (tz === 'America/Boise') return 'ID';
  if (tz === 'America/Phoenix') return 'AZ';
  // Legacy Utah rows often omit state in thin records but use Denver.
  if (tz === 'America/Denver') return 'UT';
  if (area.includes('salt lake') || area.includes('utah') || area.includes('wasatch')) return 'UT';
  return '';
}

/**
 * Older Utah title parens used abbreviations ("SLC", "Eagle Mtn"). Map those (and a
 * few incomplete labels) to the canonical place name for UI display.
 */
const CITY_DISPLAY_ALIASES: Record<string, string> = {
  slc: 'Salt Lake City',
  'salt lake': 'Salt Lake City',
  'n salt lake': 'North Salt Lake',
  'north salt lake': 'North Salt Lake',
  'eagle mtn': 'Eagle Mountain',
  'eagle mountain': 'Eagle Mountain',
  'west valley': 'West Valley City',
  'west valley city': 'West Valley City',
  stansbury: 'Stansbury Park',
  'stansbury park': 'Stansbury Park',
  's salt lake': 'South Salt Lake',
  'so salt lake': 'South Salt Lake',
  'south salt lake': 'South Salt Lake',
  'st george': 'St. George',
  'st. george': 'St. George',
};

function cityAliasKey(city: string): string {
  return city
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Expand abbreviated / incomplete city labels for display. Drops bare state codes. */
export function expandDisplayCity(city: string): string {
  const raw = String(city || '').trim();
  if (!raw) return '';
  // Title parens sometimes stored the state ("Purple Sage (WY)") — not a city.
  if (/^[A-Za-z]{2}$/.test(raw)) return '';
  return CITY_DISPLAY_ALIASES[cityAliasKey(raw)] || raw;
}

/**
 * Prefer the mailing-address city (canonical), then expand title-paren fallbacks
 * like "(SLC)". Do not use regional `area` labels ("SALT LAKE CITY AREA").
 */
export function resolveCourseCity(record: {
  name: string;
  address?: string;
  area?: string;
}): string {
  const fromAddress = expandDisplayCity(cityFromAddress(record.address));
  if (fromAddress) return fromAddress;
  const { city: titleCity } = parseCourseTitle(record.name);
  return expandDisplayCity(titleCity);
}

/** Prefer "Eagle, ID" when state is known so multi-state catalogs stay unambiguous. */
export function formatCityState(city?: string | null, state?: string | null): string {
  const c = expandDisplayCity(String(city || '').trim()) || String(city || '').trim();
  const st = String(state || '').trim().toUpperCase();
  if (!c) return st;
  if (!st) return c;
  if (new RegExp(`,\\s*${st}$`, 'i').test(c)) return c;
  return `${c}, ${st}`;
}

/**
 * How the public Find / course page should present booking.
 * Phone disposition wins even if platform/booking_url are empty.
 */
export type CourseBookingMode = 'live' | 'booking_link' | 'phone';

export function resolveCourseBookingMode(
  record?: {
    booking_status?: string | null;
    platform?: string | null;
    booking_url?: string | null;
  } | null,
): CourseBookingMode {
  const status = String(record?.booking_status || '').trim();
  if (status === 'phone') return 'phone';
  if (getPlatformCapability(effectivePlatform(record ?? {})) === 'live_inventory') return 'live';
  return 'booking_link';
}

export function recordToCourse(record: CourseRecord, distanceMi?: number): Course {
  const { short } = parseCourseTitle(record.name);
  const tz = String(record.timezone || '').trim();
  const state = stateFromRecord(record) || undefined;
  return {
    id: slugFromCourseName(record.name),
    catalogName: record.name,
    name: short,
    city: resolveCourseCity(record),
    state,
    address: record.address,
    area: record.area,
    lat: record.lat,
    lng: record.lng,
    photoUrl: coursePhotoUrl(record),
    rating: record.rating,
    reviewCount: record.review_count,
    distanceMi,
    bookingUrl: record.booking_url,
    platform: record.platform,
    holes: record.holes === 9 || record.holes === 18 ? record.holes : undefined,
    timezone: tz || undefined,
  };
}
