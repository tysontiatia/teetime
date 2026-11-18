/**
 * Course time zones come from the course's coordinates, not its state.
 * About a dozen states span two zones (TX, FL, ID, OR, KY, TN, IN, MI, KS, NE,
 * ND, SD) and most of Arizona skips daylight saving while the Navajo Nation
 * does not, so a state → zone table is wrong for real courses.
 *
 * Two lookups, because the exact one cannot run in a Worker:
 * - Node scripts (backfill, index import) use geo-tz's real boundary polygons
 *   and stamp the record with `timezone_pin` = the pin they looked up.
 * - The Worker uses tz-lookup, a compressed grid that can be wrong within about
 *   a kilometre of a zone line (Kellogg ID, Needles CA). It is only a stopgap
 *   for courses saved or moved since the last backfill.
 *
 * Order of trust: a stamped zone whose pin has not moved, then tz-lookup on the
 * pin, then any stored zone, then Mountain Time so a course with nothing polls.
 */

import tzlookup from '@photostructure/tz-lookup';

export const DEFAULT_TIMEZONE = 'America/Denver';

function validZone(zone) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA zone for a point, or null when the point is missing or out of range. */
export function timezoneForCoordinates(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  // 0,0 is a missing pin, not a course in the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;
  try {
    const zone = tzlookup(latitude, longitude);
    return validZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** The pin a zone was looked up for, rounded to about 10 m. */
export function timezonePinKey(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
}

/** True when the stored zone was set by an exact lookup for the current pin. */
export function hasExactTimezone(record) {
  const stored = String(record?.timezone || '').trim();
  const pin = timezonePinKey(record?.lat, record?.lng);
  return Boolean(pin) && record?.timezone_pin === pin && validZone(stored);
}

/** The zone a course record should use. */
export function courseTimezoneFor(record) {
  if (hasExactTimezone(record)) return String(record.timezone).trim();
  const fromPin = timezoneForCoordinates(record?.lat, record?.lng);
  if (fromPin) return fromPin;
  const stored = String(record?.timezone || '').trim();
  if (validZone(stored)) return stored;
  return DEFAULT_TIMEZONE;
}

/**
 * A record with its timezone set for its pin. Keeps an exact zone while the pin
 * is unchanged; drops the stamp once the pin moves so the backfill redoes it.
 */
export function withCourseTimezone(record) {
  if (!record || typeof record !== 'object') return record;
  if (hasExactTimezone(record)) return record;
  const zone = courseTimezoneFor(record);
  if (record.timezone === zone && !('timezone_pin' in record)) return record;
  const { timezone_pin: _stale, ...rest } = record;
  return { ...rest, timezone: zone };
}

const partFormatters = new Map();

/** Local calendar date and clock time in a zone. */
export function localParts(timeZone, date = new Date()) {
  const zone = validZone(timeZone) ? timeZone : DEFAULT_TIMEZONE;
  let fmt = partFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partFormatters.set(zone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    dateYmd: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

const offsetFormatters = new Map();

/** Minutes the zone is ahead of UTC at instant `ms` (negative in the Americas). */
function zoneOffsetMinutes(ms, timeZone) {
  let fmt = offsetFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    offsetFormatters.set(timeZone, fmt);
  }
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/**
 * The UTC instant of a wall-clock time in a zone.
 *
 * This used to step through two days a minute at a time (up to 2,880 formats
 * per tee time, ~5 ms each), which pushed the 5-minute poll past the Worker's
 * 30 s CPU limit. Now: guess with the offset at that wall time read as UTC,
 * then correct once with the offset at the guess. Two formats, cached per zone.
 *
 * Same answers as before for real tee times. Across a DST change the earlier
 * reading of a repeated hour is kept, and a time inside the skipped hour moves
 * forward by the gap, like a clock does.
 */
export function wallClockToUtcInstant(y, mo, d, hh, mm, timeZone = DEFAULT_TIMEZONE) {
  const zone = String(timeZone || '').trim() || DEFAULT_TIMEZONE;
  const wall = Date.UTC(y, mo - 1, d, hh, mm, 0);
  try {
    const first = wall - zoneOffsetMinutes(wall, zone) * 60000;
    const offset = zoneOffsetMinutes(first, zone);
    let instant = wall - offset * 60000;
    // Skipped hour (spring forward): no instant reads as `wall`; `first` is the
    // same clock time after the jump, i.e. moved forward by the gap.
    if (instant + zoneOffsetMinutes(instant, zone) * 60000 !== wall) return new Date(first);
    // Repeated hour (fall back): prefer the earlier instant when it reads the same.
    const earlier = instant - 60 * 60000;
    if (earlier + zoneOffsetMinutes(earlier, zone) * 60000 === wall) instant = earlier;
    if (Number.isFinite(instant)) return new Date(instant);
  } catch {
    // Unknown zone: fall through to Mountain Standard Time, as before.
  }
  return new Date(Date.UTC(y, mo - 1, d, hh + 7, mm, 0));
}
