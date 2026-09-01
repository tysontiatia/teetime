import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Keep in lockstep with `defaultFindDateYmd` in frontend/src/lib/time.ts.
 */
const FIND_DATE_ROLLOVER_HOUR = 17;
const TZ = 'America/Denver';

function ymdInTimeZone(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')?.value;
  const mo = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${mo}-${day}`;
}

function hour0to23(iso, timeZone) {
  const h = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(iso)).find((p) => p.type === 'hour')?.value ?? NaN,
  );
  return h === 24 ? 0 : h;
}

function shiftYmd(ymd, deltaDays) {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(y, m - 1, d + deltaDays);
  const pad = (n) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

function defaultFindDateYmd(nowIso, timeZone = TZ) {
  const today = ymdInTimeZone(nowIso, timeZone);
  const hour = hour0to23(nowIso, timeZone);
  if (Number.isFinite(hour) && hour >= FIND_DATE_ROLLOVER_HOUR) return shiftYmd(today, 1);
  return today;
}

test('dateless Find stays on today before 5:00 PM Mountain', () => {
  assert.equal(defaultFindDateYmd('2026-08-31T20:59:00.000Z'), '2026-08-31');
  assert.equal(defaultFindDateYmd('2026-08-31T22:59:00.000Z'), '2026-08-31');
});

test('dateless Find rolls to tomorrow from 5:00 PM Mountain', () => {
  assert.equal(defaultFindDateYmd('2026-08-31T23:00:00.000Z'), '2026-09-01');
  assert.equal(defaultFindDateYmd('2026-09-01T03:30:00.000Z'), '2026-09-01');
});

test('dateless Find is today again after midnight Mountain', () => {
  assert.equal(defaultFindDateYmd('2026-09-01T06:00:00.000Z'), '2026-09-01');
  assert.equal(defaultFindDateYmd('2026-09-01T12:00:00.000Z'), '2026-09-01');
});
