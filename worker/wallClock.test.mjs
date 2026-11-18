import test from 'node:test';
import assert from 'node:assert/strict';
import { wallClockToUtcInstant } from './courseTimezone.js';

/** The previous implementation, kept here only as the reference to compare against. */
function bruteForce(y, mo, d, hh, mm, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const read = (ms) => {
    const parts = fmt.formatToParts(new Date(ms));
    const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    return { y: get('year'), mo: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
  };
  for (let t = Date.UTC(y, mo - 1, d - 1, 6); t <= Date.UTC(y, mo - 1, d + 1, 6); t += 60000) {
    const g = read(t);
    if (g.y === y && g.mo === mo && g.d === d && g.hh === hh && g.mm === mm) return new Date(t);
  }
  return null;
}

const ZONES = [
  'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Boise', 'America/Chicago',
  'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'America/Indiana/Indianapolis',
];
// Ordinary days plus both 2026 US DST changes and the days around them.
const DAYS = [[2026, 1, 15], [2026, 3, 7], [2026, 3, 8], [2026, 3, 9], [2026, 7, 4], [2026, 10, 31], [2026, 11, 1], [2026, 11, 2], [2026, 12, 31]];

test('matches the old minute-by-minute search for every tee time of the day', () => {
  let checked = 0;
  for (const zone of ZONES) {
    for (const [y, mo, d] of DAYS) {
      for (let minutes = 4 * 60; minutes < 23 * 60; minutes += 113) {
        const hh = Math.floor(minutes / 60);
        const mm = minutes % 60;
        const expected = bruteForce(y, mo, d, hh, mm, zone);
        // The old search stopped at 06:00 UTC the next day, so it found nothing
        // for Hawaii from 20:00 and Alaska from 22:00 (and guessed Mountain time).
        if (!expected) continue;
        assert.equal(wallClockToUtcInstant(y, mo, d, hh, mm, zone).toISOString(), expected.toISOString(), `${zone} ${y}-${mo}-${d} ${hh}:${mm}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 700);
});

test('late evening in Hawaii and Alaska, where the old search gave up', () => {
  // 20:06 HST (UTC-10) is 06:06 UTC the next day; 22:05 AKDT (UTC-8) is 06:05 UTC.
  assert.equal(wallClockToUtcInstant(2026, 7, 4, 20, 6, 'Pacific/Honolulu').toISOString(), '2026-07-05T06:06:00.000Z');
  assert.equal(wallClockToUtcInstant(2026, 7, 4, 22, 5, 'America/Anchorage').toISOString(), '2026-07-05T06:05:00.000Z');
});

test('the repeated 1 a.m. hour keeps the earlier reading, like the old search', () => {
  const zone = 'America/Denver';
  assert.equal(wallClockToUtcInstant(2026, 11, 1, 1, 30, zone).toISOString(), bruteForce(2026, 11, 1, 1, 30, zone).toISOString());
  assert.equal(wallClockToUtcInstant(2026, 11, 1, 1, 30, zone).toISOString(), '2026-11-01T07:30:00.000Z');
});

test('a time inside the skipped spring-forward hour moves forward by the gap', () => {
  // 02:30 does not exist in Denver on 8 Mar 2026; 03:30 MDT is 09:30 UTC.
  assert.equal(wallClockToUtcInstant(2026, 3, 8, 2, 30, 'America/Denver').toISOString(), '2026-03-08T09:30:00.000Z');
});

test('an unknown zone falls back to Mountain Standard Time, as before', () => {
  assert.equal(wallClockToUtcInstant(2026, 7, 4, 8, 0, 'Not/AZone').toISOString(), '2026-07-04T15:00:00.000Z');
});
