/**
 * Exact time zone for a pin, from geo-tz's boundary polygons. Node only (it
 * reads data files from disk), so the Worker uses tz-lookup instead; see
 * worker/courseTimezone.js. Records written with this get `timezone_pin`.
 */

import { find } from 'geo-tz';
import { timezonePinKey } from '../../worker/courseTimezone.js';

export function exactTimezoneFor(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === 0 && longitude === 0) return null;
  const zones = find(latitude, longitude);
  return zones?.[0] || null;
}

/** `record` with an exact zone and pin stamp, or null when it has no usable pin. */
export function withExactTimezone(record) {
  const zone = exactTimezoneFor(record?.lat, record?.lng);
  if (!zone) return null;
  return { ...record, timezone: zone, timezone_pin: timezonePinKey(record.lat, record.lng) };
}
