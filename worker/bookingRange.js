/**
 * Vendors that tell us a date is outside the booking window.
 * Empty tee lists are not this — those are sold out or filtered.
 */

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

export function ymdInTimeZone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function diffDays(fromYmd, toYmd) {
  const [y1, m1, d1] = String(fromYmd || '').split('-').map(Number);
  const [y2, m2, d2] = String(toYmd || '').split('-').map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return null;
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Play date is after the last day the window covers (today + N, inclusive). */
export function isPastBookingWindow(playYmd, windowDays, todayYmd) {
  const days = Number(windowDays);
  if (!playYmd || !todayYmd || !Number.isFinite(days) || days < 1) return false;
  const last = addDaysYmd(todayYmd, days);
  return Boolean(last) && playYmd > last;
}

export function bookingRange(days, opensTime) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1) return null;
  const out = { error: 'booking_range', booking_window_days: n };
  const clock = String(opensTime || '').trim();
  if (clock && clock !== '00:00' && clock !== '0000') out.booking_opens_time = clock;
  return out;
}

/** "7 days in advance" from Chronogolf, GolfRev, and GolfPay. */
export function daysInAdvance(text) {
  const match = String(text || '').match(/(\d+)\s+days?\s+in\s+advance/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function longDateToYmd(text) {
  const match = String(text || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return '';
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!month || !day || !year) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * TeeItUp: "Tee times will be available to book from Friday, November 20, 2026 at 5:01 AM"
 * Days are the gap from that morning to the play date, so the open date lands on the same day.
 */
export function teeItUpBookingRange(message, playYmd) {
  const match = String(message || '').match(
    /available to book from [A-Za-z]+,\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})(?:\s+at\s+(\d{1,2}:\d{2}\s*[AP]M))?/i,
  );
  if (!match) return null;
  const opensOn = longDateToYmd(match[1]);
  const days = diffDays(opensOn, playYmd);
  if (days == null || days < 1) return null;
  return bookingRange(days, match[2]);
}

/** booking_class_id → days. The tee sheet header can say 7 while the public rate says 21. */
export function foreupWindowsFromHtml(html) {
  const windows = {};
  const re = /"booking_class_id":"(\d+)"[\s\S]{0,600}?"days_in_booking_window":"(\d+)"/g;
  for (const match of String(html || '').matchAll(re)) {
    const n = Number(match[2]);
    if (Number.isFinite(n) && n >= 1) windows[match[1]] = n;
  }
  return windows;
}

export function foreupWindowDaysFromHtml(html, bookingClassId) {
  const id = String(bookingClassId || '').replace(/[^\d]/g, '');
  if (!id) return null;
  return foreupWindowsFromHtml(html)[id] ?? null;
}
