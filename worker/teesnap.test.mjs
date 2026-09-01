/**
 * Fixture-backed TeeSnap adapter tests.
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildTeeSnapBookingUrl,
  courseHasTeeSnap,
  handleTeeSnap,
  parseTeeSnapDayPayload,
  parseTeeSnapPropertyHtml,
  pickPrimaryTeeSnapCourse,
  teeSnapCourseId,
  teeSnapTenant,
  teeSnapWallClockToRaw,
  tenantFromUrl,
} from './teesnap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'teesnap.fixture.json'), 'utf8'));

const sundanceUrl = 'https://sundancegolfclub.teesnap.net/';

test('tenant and course id from booking URL', () => {
  assert.equal(tenantFromUrl(sundanceUrl), 'sundancegolfclub');
  assert.equal(teeSnapTenant({ booking_url: sundanceUrl }), 'sundancegolfclub');
  assert.equal(teeSnapTenant({ teesnap_tenant: 'MirrorLakeGC' }), 'mirrorlakegc');
  assert.equal(teeSnapCourseId({ teesnap_course_id: '1801' }), '1801');
  assert.equal(teeSnapCourseId({ teesnap_course_id: 'x' }), '');
});

test('courseHasTeeSnap from platform or URL', () => {
  assert.equal(courseHasTeeSnap({ platform: 'teesnap' }), true);
  assert.equal(courseHasTeeSnap({ booking_url: sundanceUrl }), true);
  assert.equal(courseHasTeeSnap({ platform: 'clubcaddie' }), false);
});

test('wall clock from naive teeTime', () => {
  assert.equal(teeSnapWallClockToRaw('2026-09-02T05:52:00'), '2026-09-02 05:52');
  assert.equal(teeSnapWallClockToRaw('2026-09-02T06:40:00'), '2026-09-02 06:40');
});

test('picks the 18-hole course and skips simulators', () => {
  const picked = pickPrimaryTeeSnapCourse([
    { id: 1875, name: 'Simulator', enabled: true, customer_enabled: true, holes_array: [9, 18], max_players: 1 },
    { id: 893, name: 'Mirror Lake Golf Course', enabled: true, customer_enabled: true, holes_array: [9, 18], max_players: 4 },
  ]);
  assert.equal(picked.id, 893);
});

test('parses window.property from booking HTML', () => {
  const html = `<script>window.property = ${JSON.stringify({
    key: 'sundancegolfclub',
    courses: [
      { id: 1801, name: 'Sundance Golf Club', enabled: true, customer_enabled: true, holes_array: [9, 18], max_players: 4 },
    ],
  })};</script>`;
  const prop = parseTeeSnapPropertyHtml(html);
  assert.equal(prop.key, 'sundancegolfclub');
  assert.equal(pickPrimaryTeeSnapCourse(prop.courses).id, 1801);
});

test('full front-nine booking still emits 9h on the back; open slot fans out 9+18', () => {
  const rows = parseTeeSnapDayPayload(fixture, 4);
  assert.equal(rows.length, 3);
  const fullFrontNine = rows.find((r) => r.rawTime === '2026-09-02 05:52' && r.holes === 9);
  assert.ok(fullFrontNine);
  assert.equal(fullFrontNine.price, '$19');
  assert.equal(fullFrontNine.spots, 4);
  assert.equal(
    rows.find((r) => r.rawTime === '2026-09-02 05:52' && r.holes === 18),
    undefined,
  );
  const openNine = rows.find((r) => r.rawTime === '2026-09-02 06:40' && r.holes === 9);
  const openEighteen = rows.find((r) => r.rawTime === '2026-09-02 06:40' && r.holes === 18);
  assert.equal(openNine.price, '$19');
  assert.equal(openNine.spots, 4);
  assert.equal(openEighteen.price, '$42');
  assert.equal(openEighteen.spots, 4);
});

test('schema drift / empty payload normalize to empty', () => {
  assert.deepEqual(parseTeeSnapDayPayload(null), []);
  assert.deepEqual(parseTeeSnapDayPayload({}), []);
  assert.deepEqual(parseTeeSnapDayPayload({ teeTimes: { teeTimes: 'nope' } }), []);
});

test('booking URL stamps teedate, players, holes, cart=no', () => {
  assert.equal(
    buildTeeSnapBookingUrl({ booking_url: sundanceUrl }, '2026-09-02', 4, 18),
    'https://sundancegolfclub.teesnap.net/?teedate=2026-09-02&players=4&holes=18&cart=no',
  );
});

test('handleTeeSnap GETs teetimes-day when course id is known', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return {
      ok: true,
      json: async () => fixture,
      text: async () => '',
    };
  };
  const res = await handleTeeSnap(
    { tenant: 'sundancegolfclub', course_id: '1801', date: '2026-09-02', players: '4' },
    fetchImpl,
  );
  const body = await res.json();
  assert.equal(calls.length, 1);
  assert.match(calls[0], /sundancegolfclub\.teesnap\.net\/customer-api\/teetimes-day/);
  assert.match(calls[0], /course=1801/);
  assert.match(calls[0], /date=2026-09-02/);
  assert.equal(body.times.length, 3);
  assert.equal(body.tenant, 'sundancegolfclub');
});
