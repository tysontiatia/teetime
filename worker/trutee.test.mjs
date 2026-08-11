/**
 * Fixture-backed contract test for the Trutee (Convex) adapter.
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { normalizeTruteeTimesWorker, truteeAvailableHoles } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'trutee.fixture.json'), 'utf8'));

const SUNBROOK = 'course_5eab079479324dbc8bd128449b892177';
const DIXIE = 'course_0e421059bd49483c87be5c38f563eda1';

test('available_holes parses 9, 18, and 9/18', () => {
  assert.deepEqual(truteeAvailableHoles('9'), [9]);
  assert.deepEqual(truteeAvailableHoles('18'), [18]);
  assert.deepEqual(truteeAvailableHoles('9/18'), [9, 18]);
  assert.deepEqual(truteeAvailableHoles(''), []);
});

test('Sunbrook 9/18 open slot fans out into 9h + 18h rows with cents→dollars', () => {
  const rows = normalizeTruteeTimesWorker({ trutee_course_id: SUNBROOK }, fixture.sunbrook);
  assert.ok(rows.length >= 2, 'at least one open dual-hole slot → two rows');
  const nine = rows.find((r) => r.holes === 9 && r.rawTime.includes('07:10'));
  const eighteen = rows.find((r) => r.holes === 18 && r.rawTime.includes('07:10'));
  assert.ok(nine && eighteen, 'dual-hole tee time must emit both hole options');
  assert.equal(nine.price, '$21'); // green_fee_9 2100
  assert.equal(eighteen.price, '$34'); // green_fee_18 3400
  assert.equal(nine.spots, 4);
  assert.equal(eighteen.spots, 4);
});

test('sold-out slots (available_spots 0) are omitted', () => {
  const rows = normalizeTruteeTimesWorker({ trutee_course_id: SUNBROOK }, fixture.sunbrook);
  assert.ok(rows.every((r) => r.spots == null || r.spots > 0));
});

test('Dixie 9-only course emits a single 9-hole row', () => {
  const rows = normalizeTruteeTimesWorker({ trutee_course_id: DIXIE }, fixture.dixie);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].holes, 9);
  assert.equal(rows[0].price, '$19'); // green_fee_9 1900
  assert.ok(rows[0].rawTime.includes('08:00'));
});

test('course isolation: mismatched trutee_course_id yields no rows', () => {
  const rows = normalizeTruteeTimesWorker({ trutee_course_id: 'course_deadbeef' }, fixture.sunbrook);
  assert.deepEqual(rows, []);
});

test('schema drift / errors normalize to empty', () => {
  assert.deepEqual(normalizeTruteeTimesWorker({ trutee_course_id: SUNBROOK }, { error: 'nope' }), []);
  assert.deepEqual(normalizeTruteeTimesWorker({ trutee_course_id: SUNBROOK }, {}), []);
  assert.deepEqual(normalizeTruteeTimesWorker({ trutee_course_id: SUNBROOK }, null), []);
});
