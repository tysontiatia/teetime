/**
 * Fixture-backed contract test for the GolfPay adapter.
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { golfPayCourseId, normalizeGolfPayTimesWorker } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'golfpay.fixture.json'), 'utf8'));

test('golfPayCourseId prefers explicit id, then template, then booking_url', () => {
  assert.equal(golfPayCourseId({ golfpay_course_id: '1466' }), '1466');
  assert.equal(
    golfPayCourseId({
      booking_url_template: 'https://golfpay.co/course/x?_gshcid=1466&date=2026-01-01',
    }),
    '1466',
  );
  assert.equal(
    golfPayCourseId({ booking_url: 'https://golfpay.co/course/x?lp=1&_gshcid=99' }),
    '99',
  );
  assert.equal(golfPayCourseId({ booking_url: 'https://golfpay.co/course/x' }), '');
});

test('skips online-block placeholders and emits real priced rows', () => {
  const rows = normalizeGolfPayTimesWorker({}, fixture);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.price && !r.price.includes('$1')));
});

test('18h Front slot keeps lowest public price and remaining spots', () => {
  const rows = normalizeGolfPayTimesWorker({}, fixture);
  const eighteen = rows.find((r) => r.holes === 18 && r.rawTime.includes('06:30'));
  assert.ok(eighteen);
  assert.equal(eighteen.price, '$52');
  assert.equal(eighteen.spots, 2);
});

test('9h Back slot normalizes wall-clock and price', () => {
  const rows = normalizeGolfPayTimesWorker({}, fixture);
  const nine = rows.find((r) => r.holes === 9 && r.rawTime.includes('06:20'));
  assert.ok(nine);
  assert.equal(nine.price, '$27');
  assert.equal(nine.spots, 4);
});

test('schema drift / errors normalize to empty', () => {
  assert.deepEqual(normalizeGolfPayTimesWorker({}, { error: 'nope' }), []);
  assert.deepEqual(normalizeGolfPayTimesWorker({}, {}), []);
  assert.deepEqual(normalizeGolfPayTimesWorker({}, null), []);
  assert.deepEqual(normalizeGolfPayTimesWorker({}, { data: { times: 'bad' } }), []);
});
