import type { CourseRecord } from './courseRecord';
import { formatTime12h } from './time';

export type BookingLinkParams = {
  dateYmd: string;
  players: number;
  holes?: number;
  /** Optional selected tee time — only applied when the template includes `{time}`. */
  startsAtIso?: string | null;
};

function foreupDateUs(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${m}-${d}-${y}`;
}

function applyTemplate(template: string, params: BookingLinkParams): string {
  const holes = String(params.holes === 9 ? 9 : 18);
  const time =
    params.startsAtIso != null && params.startsAtIso !== ''
      ? encodeURIComponent(formatTime12h(params.startsAtIso))
      : '';
  return template
    .replace(/\{date\}/g, params.dateYmd)
    .replace(/\{date_us\}/g, foreupDateUs(params.dateYmd))
    .replace(/\{players\}/g, String(Math.min(Math.max(params.players || 1, 1), 4)))
    .replace(/\{holes\}/g, holes)
    .replace(/\{time\}/g, time);
}

type ForeUpIds = {
  facilityId: string | null;
  scheduleId: string | null;
  host: string;
};

/** Parse facility / schedule IDs from a ForeUp booking URL or template. */
function parseForeUpIds(url: string, scheduleFromRecord?: string | null): ForeUpIds {
  const hostMatch = url.match(/https?:\/\/([^/]+)/i);
  const host = hostMatch?.[1] || 'foreupsoftware.com';
  const path = url.split('#')[0] || url;

  const facilitySchedule = path.match(/\/booking\/(\d+)\/(\d+)/);
  if (facilitySchedule) {
    return {
      facilityId: facilitySchedule[1]!,
      scheduleId: scheduleFromRecord || facilitySchedule[2]!,
      host,
    };
  }

  const indexFacility = path.match(/\/booking\/index\/(\d+)/);
  if (indexFacility) {
    return {
      facilityId: indexFacility[1]!,
      scheduleId: scheduleFromRecord || null,
      host,
    };
  }

  const facilityOnly = path.match(/\/booking\/(\d+)(?:\/?#|$|\?)/);
  if (facilityOnly) {
    return {
      facilityId: facilityOnly[1]!,
      scheduleId: scheduleFromRecord || null,
      host,
    };
  }

  return { facilityId: null, scheduleId: scheduleFromRecord || null, host };
}

/**
 * ForeUp's `/booking/index/{facility}` page is the booking-class picker.
 * Deep-link to the schedule tee sheet instead: `/booking/{facility}/{schedule}#/teetimes`.
 */
function buildForeUpTeeSheetUrl(
  source: BookingSource,
  params: BookingLinkParams,
): string | null {
  const bookingUrl = (source.booking_url || source.bookingUrl || '').trim();
  const templateOverride = (source.booking_url_template || '').trim();
  const scheduleId = source.schedule_id != null ? String(source.schedule_id).trim() : '';

  const parseFrom = templateOverride || bookingUrl;
  const ids = parseForeUpIds(parseFrom, scheduleId || null);

  // Best path: facility + schedule → skip the booking-class picker.
  if (ids.facilityId && ids.scheduleId) {
    const sheet = `https://${ids.host}/index.php/booking/${ids.facilityId}/${ids.scheduleId}#/teetimes`;
    return ensureForeUpDateOnTeeSheet(sheet, params);
  }

  // Explicit tee-sheet template (not /booking/index/) when we lack a schedule id.
  if (templateOverride && !/\/booking\/index\//i.test(templateOverride)) {
    let sheet = templateOverride;
    if (sheet.includes('{')) {
      sheet = applyTemplate(sheet, params);
    }
    return ensureForeUpDateOnTeeSheet(sheet, params);
  }

  if (ids.facilityId) {
    // Facility-only sheet (some clubs); still better than the class picker.
    const sheet = `https://${ids.host}/index.php/booking/${ids.facilityId}#/teetimes`;
    return ensureForeUpDateOnTeeSheet(sheet, params);
  }

  // Last resort: if booking_url is already a schedule path, add #/teetimes + date.
  if (bookingUrl && /foreupsoftware\.com/i.test(bookingUrl) && !/\/booking\/index\//i.test(bookingUrl)) {
    return ensureForeUpDateOnTeeSheet(bookingUrl, params);
  }

  return bookingUrl || null;
}

/** Ensure ForeUp tee-sheet URLs include #/teetimes and a date (hash query). */
function ensureForeUpDateOnTeeSheet(url: string, params: BookingLinkParams): string {
  let out = url.trim();
  const dateUs = foreupDateUs(params.dateYmd);
  const players = String(Math.min(Math.max(params.players || 1, 1), 4));
  const holes = String(params.holes === 9 ? 9 : 18);

  // Normalize hash to #/teetimes
  if (!/#\/?teetimes/i.test(out)) {
    out = out.replace(/#.*$/, '').replace(/\/$/, '');
    out = `${out}#/teetimes`;
  } else {
    // Force #/teetimes (some catalog rows use #teetimes without slash)
    out = out.replace(/#\/?teetimes.*/i, '#/teetimes');
  }

  const hashIdx = out.indexOf('#');
  const before = hashIdx >= 0 ? out.slice(0, hashIdx) : out;
  // Put party params on the path query; date on the hash (ForeUp SPA reads both patterns).
  try {
    const u = new URL(before);
    u.searchParams.set('date', dateUs);
    u.searchParams.set('players', players);
    u.searchParams.set('holes', holes);
    return `${u.toString().replace(/\/$/, '')}#/teetimes?date=${encodeURIComponent(dateUs)}`;
  } catch {
    const sep = before.includes('?') ? '&' : '?';
    return `${before}${sep}date=${dateUs}&players=${players}&holes=${holes}#/teetimes?date=${encodeURIComponent(dateUs)}`;
  }
}

function defaultTemplate(
  record: Pick<CourseRecord, 'platform' | 'booking_url'>,
): string | null {
  const base = record.booking_url?.trim();
  if (!base) return null;
  const clean = base.replace(/\/$/, '');

  switch (record.platform) {
    case 'chronogolf':
    case 'chronogolf_slc':
      return `${clean}?date={date}&players={players}`;
    default:
      return base;
  }
}

export type BookingSource = {
  booking_url?: string | null;
  bookingUrl?: string | null;
  booking_url_template?: string | null;
  platform?: string | null;
  schedule_id?: string | number | null;
};

/**
 * Build an outbound vendor booking URL with date / players / holes when the
 * platform (or catalog template) supports it. Falls back to the bare booking URL.
 */
export function buildBookingUrl(
  source: BookingSource | CourseRecord | null | undefined,
  params: BookingLinkParams,
): string | null {
  if (!source) return null;

  const bookingUrl =
    ('booking_url' in source && source.booking_url?.trim()) ||
    ('bookingUrl' in source && source.bookingUrl?.trim()) ||
    null;

  const platform = ('platform' in source && source.platform) || undefined;
  const templateOverride =
    ('booking_url_template' in source && source.booking_url_template?.trim()) || null;
  const scheduleId =
    'schedule_id' in source && source.schedule_id != null ? String(source.schedule_id) : null;

  const bookingSource: BookingSource = {
    booking_url: bookingUrl,
    booking_url_template: templateOverride,
    platform,
    schedule_id: scheduleId,
  };

  if (platform === 'foreup' || platform === 'foreup_login') {
    return buildForeUpTeeSheetUrl(bookingSource, params) || bookingUrl;
  }

  if (!bookingUrl) return null;

  const template = templateOverride || defaultTemplate({ platform: platform || '', booking_url: bookingUrl });
  if (!template) return bookingUrl;

  if (template.includes('{')) {
    return applyTemplate(template, params);
  }
  return template;
}
