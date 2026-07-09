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

/**
 * Default deep-link patterns for Utah platforms.
 * ForeUp: query params (matches alert SMS/email enrichment).
 * Chronogolf: date + players on the club booking URL.
 * Others: bare booking_url unless `booking_url_template` is set.
 */
function defaultTemplate(record: Pick<CourseRecord, 'platform' | 'booking_url'>): string | null {
  const base = record.booking_url?.trim();
  if (!base) return null;
  const clean = base.replace(/\/$/, '');

  switch (record.platform) {
    case 'foreup':
    case 'foreup_login':
      if (!base.includes('foreupsoftware.com')) return base;
      return `${clean}?date={date_us}&players={players}&holes={holes}`;
    case 'chronogolf':
    case 'chronogolf_slc':
      return `${clean}?date={date}&players={players}`;
    default:
      return base;
  }
}

type BookingSource = {
  booking_url?: string | null;
  bookingUrl?: string | null;
  booking_url_template?: string | null;
  platform?: string | null;
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
  if (!bookingUrl) return null;

  const platform = ('platform' in source && source.platform) || undefined;
  const templateOverride =
    ('booking_url_template' in source && source.booking_url_template?.trim()) || null;

  const recordLike = {
    platform: platform || '',
    booking_url: bookingUrl,
  };

  const template = templateOverride || defaultTemplate(recordLike);
  if (!template) return bookingUrl;

  if (template.includes('{')) {
    return applyTemplate(template, params);
  }
  return template;
}
