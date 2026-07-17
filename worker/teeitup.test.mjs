/**
 * Fixture-backed contract test for the TeeItUp (Aspira / kenna.io) adapter.
 * Run: `npm test`. If the live response shape drifts, these assertions fail
 * loudly here (and the poller returns `teeitup_schema_drift` at runtime).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { normalizeTeeItUpTimesWorker, teeItUpAlias, utcIsoToMtLocal } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'teeitup.fixture.json'), 'utf8'));

const SOLDIER_HOLLOW_GOLD = '5e208551241fa20100d28007';
const PALISADE = '54f14df70c8ad60378b046ad';

test('UTC teetime renders as America/Denver wall clock (MDT)', () => {
  assert.equal(utcIsoToMtLocal('2026-07-22T14:00:00.000Z'), '2026-07-22 08:00');
  assert.equal(utcIsoToMtLocal('2026-07-22T21:20:00.000Z'), '2026-07-22 15:20');
  assert.equal(utcIsoToMtLocal('not-a-date'), null);
});

test('Palisade fans out one row PER RATE (9-hole + 18-hole on the same tee time)', () => {
  const rows = normalizeTeeItUpTimesWorker({ teeitup_course_id: PALISADE }, fixture);
  assert.equal(rows.length, 2, 'dual-rate tee time must emit two rows');

  const nine = rows.find((r) => r.holes === 9);
  const eighteen = rows.find((r) => r.holes === 18);
  assert.ok(nine && eighteen, 'both a 9-hole and 18-hole row are required');

  // Same tee time, distinct holes/price — must not collapse or mis-price.
  assert.equal(nine.rawTime, '2026-07-22 09:40');
  assert.equal(eighteen.rawTime, '2026-07-22 09:40');
  assert.equal(nine.price, '$30'); // greenFeeCart 3000 (cents) → whole dollars
  assert.equal(eighteen.price, '$50'); // greenFeeCart 5000
  assert.equal(nine.spots, 4); // maxPlayers = open spots
  assert.equal(eighteen.spots, 4);
});

test('single-rate course emits one row per tee time; maxPlayers = open spots', () => {
  const rows = normalizeTeeItUpTimesWorker({ teeitup_course_id: SOLDIER_HOLLOW_GOLD }, fixture);
  assert.equal(rows.length, 2, 'two tee times, one rate each');
  assert.ok(rows.every((r) => r.holes === 18));
  assert.ok(rows.every((r) => r.price === '$85')); // greenFeeCart 8500

  const partial = rows.find((r) => r.rawTime === '2026-07-22 15:20');
  assert.ok(partial, '21:20Z tee time should convert to 15:20 MT');
  assert.equal(partial.spots, 1, 'bookedPlayers 3 / maxPlayers 1 = 1 spot left');
});

test('course isolation: only the matching courseId hash is emitted', () => {
  const rows = normalizeTeeItUpTimesWorker({ teeitup_course_id: PALISADE }, fixture);
  // Palisade prices only — no $85 Soldier Hollow rows leaked in.
  assert.ok(rows.every((r) => r.price !== '$85'));
});

test('unknown courseId hash yields no rows (skipped, not thrown)', () => {
  const rows = normalizeTeeItUpTimesWorker({ teeitup_course_id: 'deadbeef' }, fixture);
  assert.deepEqual(rows, []);
});

test('non-array payload (schema drift) normalizes to empty', () => {
  assert.deepEqual(normalizeTeeItUpTimesWorker({ teeitup_course_id: PALISADE }, { error: 'nope' }), []);
});

test('tenant alias resolves per course (any TeeItUp operator, not just Aspira)', () => {
  // Explicit override wins.
  assert.equal(teeItUpAlias({ teeitup_alias: 'custom-tenant' }), 'custom-tenant');
  // Derived from the booking_url subdomain — both host patterns.
  assert.equal(
    teeItUpAlias({ booking_url: 'https://aspira-management-company.book-v2.teeitup.golf/?course=6847' }),
    'aspira-management-company',
  );
  assert.equal(
    teeItUpAlias({ booking_url: 'https://hideout-golf-club.book.teeitup.com/?course=17083' }),
    'hideout-golf-club',
  );
  // Falls back to Aspira when nothing is set.
  assert.equal(teeItUpAlias({}), 'aspira-management-company');
});
