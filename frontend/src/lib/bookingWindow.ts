import type { CourseRecord } from './courseRecord';
import { shiftYmd, todayYmd } from './time';
import { UTAH_TEE_TIMEZONE } from './teeTimeInstant';

export type BookingRelease = {
  /** Calendar day the sheet for `playYmd` is released. */
  opensOn: string;
  /** Short badge, e.g. "Opens Tue". */
  label: string;
  /** Sentence under the photo. */
  detail: string;
};

function weekdayShort(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { weekday: 'short' });
}

function weekdayLong(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { weekday: 'long' });
}

function monthDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Minutes since midnight in Mountain Time, or null. */
function nowMinutesMt(): number | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: UTAH_TEE_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

/** "7:00 AM" or "07:00" → minutes since midnight. */
export function parseOpensClock(raw: string | undefined | null): number | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  const m = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? '0');
  const mer = m[3]?.toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    if (mer === 'pm' && hour !== 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

function formatClock(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const mer = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${mer}`;
}

function whenPhrase(opensOn: string, today: string): { short: string; long: string } {
  if (opensOn === today) return { short: 'today', long: 'today' };
  const tomorrow = shiftYmd(today, 1);
  if (opensOn === tomorrow) return { short: 'tomorrow', long: 'tomorrow' };
  if (opensOn < shiftYmd(today, 7)) {
    const day = weekdayShort(opensOn);
    return { short: day, long: weekdayLong(opensOn) };
  }
  return { short: monthDay(opensOn), long: `${weekdayLong(opensOn)}, ${monthDay(opensOn)}` };
}

/**
 * A course that books N days out cannot show `playYmd` until that sheet is released.
 * Live tee times win over this — callers should ignore it when times are already on the card.
 * Courses with no window stay null so we don't invent a release day.
 */
export function bookingRelease(
  record: Pick<CourseRecord, 'booking_window_days' | 'booking_opens_time'> | undefined,
  playYmd: string,
  today: string = todayYmd(),
  /** Days the tee sheet itself reported. */
  sheetDays?: number | null,
  /** Clock the tee sheet named, e.g. TeeItUp "5:01 AM" or Trutee "06:00". */
  sheetOpensTime?: string | null,
): BookingRelease | null {
  const fromSheet = sheetDays != null && Number.isFinite(sheetDays) && sheetDays >= 1 ? sheetDays : null;
  const days = fromSheet ?? record?.booking_window_days;
  if (days == null || !Number.isFinite(days) || days < 1) return null;
  if (!playYmd || playYmd <= today) return null;

  const lastBookable = shiftYmd(today, days);
  const opensOn = shiftYmd(playYmd, -days);
  const opensAt = parseOpensClock(sheetOpensTime || record?.booking_opens_time);
  const stillBeforeOpen =
    playYmd === lastBookable && opensOn === today && opensAt != null && (nowMinutesMt() ?? 24 * 60) < opensAt;

  if (playYmd <= lastBookable && !stillBeforeOpen) return null;
  if (opensOn < today) return null;

  const when = whenPhrase(opensOn, today);
  const clock = opensAt != null ? formatClock(opensAt) : null;
  const label = when.short === 'today' || when.short === 'tomorrow' ? `Opens ${when.short}` : `Opens ${when.short}`;
  const detail = clock
    ? `Booking opens ${when.long} at ${clock}`
    : `Booking opens ${when.long}`;
  return { opensOn, label, detail };
}
