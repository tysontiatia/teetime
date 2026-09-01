/**
 * Fixture-backed GolfWithAccess adapter tests.
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildGolfWithAccessBookingUrl,
  courseHasGolfWithAccess,
  facilitySlugFromUrl,
  golfWithAccessClientHeaders,
  golfWithAccessCourseId,
  golfWithAccessDayTimeToRaw,
  golfWithAccessFacilitySlug,
  handleGolfWithAccess,
  normalizeGolfWithAccessTimesWorker,
} from './golfwithaccess.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'golfwithaccess.fixture.json'), 'utf8'));

test('facility slug from booking URL and explicit field', () => {
  assert.equal(
    facilitySlugFromUrl('https://golfwithaccess.com/course/lookout-mountain-golf-club/reserve-tee-time'),
    'lookout-mountain-golf-club',
  );
  assert.equal(
    golfWithAccessFacilitySlug({
      booking_url: 'https://golfwithaccess.com/course/wohali/reserve-tee-time?date=2026-09-01',
    }),
    'wohali',
  );
  assert.equal(
    golfWithAccessFacilitySlug({ golfwithaccess_slug: 'Lookout-Mountain-Golf-Club' }),
    'lookout-mountain-golf-club',
  );
  assert.equal(facilitySlugFromUrl('https://example.com/course/wohali/reserve-tee-time'), '');
});

test('course UUID only when well-formed', () => {
  assert.equal(
    golfWithAccessCourseId({ golfwithaccess_course_id: 'fd506bf4-ae6a-4a92-ae3f-7f847f098fb2' }),
    'fd506bf4-ae6a-4a92-ae3f-7f847f098fb2',
  );
  assert.equal(golfWithAccessCourseId({ golfwithaccess_course_id: 'not-a-uuid' }), '');
});

test('courseHasGolfWithAccess from platform or URL', () => {
  assert.equal(courseHasGolfWithAccess({ platform: 'golfwithaccess' }), true);
  assert.equal(
    courseHasGolfWithAccess({ booking_url: 'https://golfwithaccess.com/course/wohali/reserve-tee-time' }),
    true,
  );
  assert.equal(courseHasGolfWithAccess({ platform: 'quick18' }), false);
});

test('dayTime pads to worker rawTime', () => {
  assert.equal(
    golfWithAccessDayTimeToRaw({ year: 2026, month: 9, day: 1, hour: 7, minute: 20, second: 0 }),
    '2026-09-01 07:20',
  );
});

test('keeps public cash rates and skips member-only slots', () => {
  const rows = normalizeGolfWithAccessTimesWorker({}, fixture);
  assert.equal(rows.length, 2);
  const eighteen = rows.find((r) => r.holes === 18);
  assert.ok(eighteen);
  assert.equal(eighteen.rawTime, '2026-09-01 07:20');
  assert.equal(eighteen.price, '$74');
  assert.equal(eighteen.spots, 4);
  const nine = rows.find((r) => r.holes === 9);
  assert.ok(nine);
  assert.equal(nine.price, '$39');
  assert.equal(nine.spots, 2);
});

test('schema drift / errors normalize to empty', () => {
  assert.deepEqual(normalizeGolfWithAccessTimesWorker({}, { error: 'nope' }), []);
  assert.deepEqual(normalizeGolfWithAccessTimesWorker({}, {}), []);
  assert.deepEqual(normalizeGolfWithAccessTimesWorker({}, null), []);
  assert.deepEqual(normalizeGolfWithAccessTimesWorker({}, { teeTimes: 'bad' }), []);
});

test('booking URL stamps date and players', () => {
  assert.equal(
    buildGolfWithAccessBookingUrl(
      { booking_url: 'https://golfwithaccess.com/course/wohali/reserve-tee-time' },
      '2026-09-01',
      4,
    ),
    'https://golfwithaccess.com/course/wohali/reserve-tee-time?date=2026-09-01&players=4&startAt=0&endAt=24&view=time&payMode=dollars',
  );
});

test('client headers include Troon Access fields', () => {
  const h = golfWithAccessClientHeaders();
  assert.equal(h['x-troon-client-platform'], 'access-web');
  assert.equal(h['x-troon-client-version'], 'tee-time.io');
  assert.match(h['x-session-id'], /^[0-9a-f-]{36}$/i);
  assert.match(h['x-trace-id'], /^[0-9a-f-]{36}$/i);
});

test('handleGolfWithAccess fetches tee-times with course UUID', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), headers: opts?.headers || {} });
    return {
      ok: true,
      json: async () => fixture,
    };
  };
  const res = await handleGolfWithAccess(
    { course_id: 'fd506bf4-ae6a-4a92-ae3f-7f847f098fb2', date: '2026-09-01', players: '2' },
    fetchImpl,
  );
  const body = await res.json();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/tee-times\?/);
  assert.match(calls[0].url, /courseIds=fd506bf4-ae6a-4a92-ae3f-7f847f098fb2/);
  assert.match(calls[0].url, /players=2/);
  assert.match(calls[0].url, /day=2026-09-01/);
  assert.equal(calls[0].headers['x-troon-client-platform'], 'access-web');
  assert.equal(body.teeTimes.length, 3);
});
