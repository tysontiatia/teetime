import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildGolfRevBookingUrl,
  courseHasGolfRev,
  golfRevClockToRaw,
  golfRevCourseId,
  golfRevHtc,
  handleGolfRev,
  idsFromUrl,
  parseGolfRevTeeTimesHtml,
  ymdToGolfRevDate,
} from './golfrev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(resolve(__dirname, 'golfrev.fixture.html'), 'utf8');

const birchUrl = 'https://www.golfrev.com/go/tee_times/?htc=370&courseid=3719&r=1';

const singlePriceCard = `
<div class="card" onClick= showBooking('2026-09-02',100,7,0,4,0,'1',0,0,0,''); return false;>
  <h5 class="card-title">7:00 AM</h5>
  <p>4 players</p>
  <p>$49.06</p>
</div>`;

test('course id and htc from booking URL', () => {
  assert.deepEqual(idsFromUrl(birchUrl), { courseId: '3719', htc: '370' });
  assert.equal(golfRevCourseId({ booking_url: birchUrl }), '3719');
  assert.equal(golfRevHtc({ booking_url: birchUrl }), '370');
  assert.equal(golfRevCourseId({ golfrev_course_id: '4048' }), '4048');
  assert.equal(golfRevHtc({ golfrev_htc: '363' }), '363');
  assert.equal(golfRevCourseId({ golfrev_course_id: 'x' }), '');
});

test('courseHasGolfRev from platform or URL', () => {
  assert.equal(courseHasGolfRev({ platform: 'golfrev' }), true);
  assert.equal(courseHasGolfRev({ booking_url: birchUrl }), true);
  assert.equal(courseHasGolfRev({ platform: 'teesnap' }), false);
});

test('date and clock helpers', () => {
  assert.equal(ymdToGolfRevDate('2026-09-02'), '9/2/2026');
  assert.equal(golfRevClockToRaw('2026-09-02', 8, 16), '2026-09-02 08:16');
  assert.equal(golfRevClockToRaw('2026-09-02', 13, 4), '2026-09-02 13:04');
});

test('parses Birch Creek range cards as 9h min and 18h max', () => {
  const rows = parseGolfRevTeeTimesHtml(fixture, '2026-09-02');
  assert.ok(rows.length > 10);
  const firstNine = rows.find((r) => r.rawTime === '2026-09-02 08:16' && r.holes === 9);
  const firstEighteen = rows.find((r) => r.rawTime === '2026-09-02 08:16' && r.holes === 18);
  assert.equal(firstNine?.price, '$21');
  assert.equal(firstNine?.spots, 2);
  assert.equal(firstEighteen?.price, '$42');
  assert.equal(firstEighteen?.spots, 2);
  const fourPack = rows.find((r) => r.rawTime === '2026-09-02 10:16' && r.holes === 18);
  assert.equal(fourPack?.spots, 4);
  assert.equal(fourPack?.price, '$42');
});

test('single price card is 18 holes', () => {
  const rows = parseGolfRevTeeTimesHtml(singlePriceCard, '2026-09-02');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].holes, 18);
  assert.equal(rows[0].price, '$49');
  assert.equal(rows[0].spots, 4);
  assert.equal(rows[0].rawTime, '2026-09-02 07:00');
});

test('schema drift / empty html normalize to empty', () => {
  assert.deepEqual(parseGolfRevTeeTimesHtml('', '2026-09-02'), []);
  assert.deepEqual(parseGolfRevTeeTimesHtml('<html>no times</html>', '2026-09-02'), []);
});

test('booking URL stamps startdate, courseid, and htc', () => {
  assert.equal(
    buildGolfRevBookingUrl({ booking_url: birchUrl }, '2026-09-02', 4),
    'https://www.golfrev.com/go/tee_times/?htc=370&courseid=3719&r=1&startdate=9%2F2%2F2026&players=4',
  );
});

test('handleGolfRev GETs teetime_table_html.asp when ids are known', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { ok: true, text: async () => fixture };
  };
  const res = await handleGolfRev({ date: '2026-09-02', course_id: '3719', htc: '370' }, fetchImpl);
  const body = await res.json();
  assert.match(calls[0], /teetime_table_html\.asp/);
  assert.match(calls[0], /c=3719/);
  assert.match(calls[0], /h=370/);
  assert.match(calls[0], /s=2026-09-02/);
  assert.equal(body.date, '2026-09-02');
  assert.ok(body.times.length > 10);
  assert.equal(body.times[0].rawTime, '2026-09-02 08:16');
});
