/**
 * Fixture-backed ClubCaddie adapter tests.
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  apiKeyFromUrl,
  buildClubCaddieBookingUrl,
  clubCaddieApiKey,
  clubCaddieClockToRaw,
  clubCaddieCourseId,
  clubCaddieHost,
  courseHasClubCaddie,
  handleClubCaddie,
  parseClubCaddieTeeTimesHtml,
  ymdToClubCaddieDate,
} from './clubcaddie.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(__dirname, 'clubcaddie.fixture.html'), 'utf8');

const foothillsUrl =
  'https://apimanager-cc37.clubcaddie.com/webapi/view/hiedabab/slots?date=08%2F26%2F2026&player=1&ratetype=any&Interaction=sk9ld5ehbp0apegdi70d9h0nb2';

test('host and apikey from booking URL', () => {
  assert.equal(clubCaddieHost({ booking_url: foothillsUrl }), 'apimanager-cc37.clubcaddie.com');
  assert.equal(clubCaddieApiKey({ booking_url: foothillsUrl }), 'hiedabab');
  assert.equal(apiKeyFromUrl(foothillsUrl), 'hiedabab');
  assert.equal(clubCaddieApiKey({ clubcaddie_apikey: 'FIEDABAB' }), 'fiedabab');
  assert.equal(clubCaddieCourseId({ clubcaddie_course_id: '103388' }), '103388');
  assert.equal(clubCaddieCourseId({ clubcaddie_course_id: 'x' }), '');
});

test('courseHasClubCaddie from platform or URL', () => {
  assert.equal(courseHasClubCaddie({ platform: 'clubcaddie' }), true);
  assert.equal(courseHasClubCaddie({ booking_url: foothillsUrl }), true);
  assert.equal(courseHasClubCaddie({ platform: 'quick18' }), false);
});

test('date and clock helpers', () => {
  assert.equal(ymdToClubCaddieDate('2026-09-01'), '09/01/2026');
  assert.equal(clubCaddieClockToRaw('2026-09-01', '05:40 AM'), '2026-09-01 05:40');
  assert.equal(clubCaddieClockToRaw('2026-09-01', '11:20 AM'), '2026-09-01 11:20');
  assert.equal(clubCaddieClockToRaw('2026-09-01', '12:00 PM'), '2026-09-01 12:00');
  assert.equal(clubCaddieClockToRaw('2026-09-01', '1:05 PM'), '2026-09-01 13:05');
});

test('parses bigscreen cards and skips smallscreen duplicates', () => {
  const rows = parseClubCaddieTeeTimesHtml(fixture, '2026-09-01');
  assert.equal(rows.length, 2);
  const nine = rows.find((r) => r.holes === 9);
  assert.ok(nine);
  assert.equal(nine.rawTime, '2026-09-01 05:40');
  assert.equal(nine.price, '$25');
  assert.equal(nine.spots, 4);
  const eighteen = rows.find((r) => r.holes === 18);
  assert.ok(eighteen);
  assert.equal(eighteen.rawTime, '2026-09-01 11:20');
  assert.equal(eighteen.price, '$52');
  assert.equal(eighteen.spots, 4);
});

test('schema drift / empty html normalize to empty', () => {
  assert.deepEqual(parseClubCaddieTeeTimesHtml('', '2026-09-01'), []);
  assert.deepEqual(parseClubCaddieTeeTimesHtml('<script>PHPSESSID</script>', '2026-09-01'), []);
});

test('booking URL stamps MM/DD/YYYY date and player, drops Interaction', () => {
  assert.equal(
    buildClubCaddieBookingUrl({ booking_url: foothillsUrl }, '2026-09-01', 4),
    'https://apimanager-cc37.clubcaddie.com/webapi/view/hiedabab/slots?date=09%2F01%2F2026&player=4&ratetype=any',
  );
});

test('handleClubCaddie POSTs TeeTimes when course id is known', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), method: opts?.method || 'GET', body: opts?.body || '' });
    return {
      ok: true,
      headers: { get: () => null },
      text: async () => fixture,
    };
  };
  const res = await handleClubCaddie(
    {
      host: 'apimanager-cc37.clubcaddie.com',
      apikey: 'hiedabab',
      course_id: '103388',
      date: '2026-09-01',
      players: '4',
    },
    fetchImpl,
  );
  const body = await res.json();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/webapi\/TeeTimes$/);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].body, /CourseId=103388/);
  assert.match(calls[0].body, /apikey=hiedabab/);
  assert.match(calls[0].body, /date=09%2F01%2F2026/);
  assert.equal(body.times.length, 2);
  assert.equal(body.times[0].rawTime, '2026-09-01 05:40');
});
