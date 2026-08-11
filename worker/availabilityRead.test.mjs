/**
 * Unit tests for batched /v1/tee-times helpers (no PostgREST).
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTeeTimesBySlug,
  parseTeeTimesIds,
  postgrestInList,
  TEE_TIMES_BATCH_MAX_IDS,
} from './availabilityRead.js';

test('parseTeeTimesIds dedupes and rejects empty / oversized', () => {
  assert.deepEqual(parseTeeTimesIds('a,b, a').slugs, ['a', 'b']);
  assert.equal(parseTeeTimesIds('').ok, false);
  assert.equal(parseTeeTimesIds('   ,  ').ok, false);
  const many = Array.from({ length: TEE_TIMES_BATCH_MAX_IDS + 1 }, (_, i) => `c${i}`).join(',');
  const over = parseTeeTimesIds(many);
  assert.equal(over.ok, false);
  assert.equal(over.error, 'too_many_ids');
});

test('postgrestInList quotes slugs', () => {
  assert.equal(postgrestInList(['meadow-brook-slc', 'bonneville-slc']), '"meadow-brook-slc","bonneville-slc"');
});

test('buildTeeTimesBySlug groups coverage, filters players, fills missing slugs', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const by = buildTeeTimesBySlug(
    ['alpha', 'beta', 'gamma'],
    [
      { course_slug: 'alpha', last_success_at: '2026-08-11T12:00:00.000Z' },
      { course_slug: 'beta', last_success_at: null },
    ],
    [
      {
        id: '1',
        course_slug: 'alpha',
        play_starts_at: future,
        starts_at_local: '14:20:00',
        price_cents: 4700,
        spots_open: 4,
        holes: 18,
      },
      {
        id: '2',
        course_slug: 'alpha',
        play_starts_at: future,
        starts_at_local: '14:30:00',
        price_cents: 4700,
        spots_open: 1,
        holes: 18,
      },
    ],
    [
      {
        course_slug: 'alpha',
        starts_at_local: '14:20:00',
        holes: 18,
        created_at: '2026-08-11T10:00:00.000Z',
      },
    ],
    2,
  );

  assert.equal(by.alpha.has_poll_coverage, true);
  assert.equal(by.alpha.times.length, 1);
  assert.equal(by.alpha.times[0].id, '1');
  assert.equal(by.alpha.times[0].reopenedAt, '2026-08-11T10:00:00.000Z');
  assert.equal(by.beta.has_poll_coverage, false);
  assert.deepEqual(by.beta.times, []);
  assert.equal(by.gamma.has_poll_coverage, false);
  assert.deepEqual(by.gamma.times, []);
});
