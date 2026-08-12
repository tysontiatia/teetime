/**
 * Unit tests for batched /v1/tee-times helpers (no PostgREST).
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTeeTimesBySlug,
  normalizedRowsToBatchTimes,
  parseTeeTimesIds,
  postgrestInList,
  snapshotNeedsLiveFill,
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
  assert.equal(by.alpha.source, 'snapshot');
  assert.equal(by.alpha.times.length, 1);
  assert.equal(by.alpha.times[0].id, '1');
  assert.equal(by.alpha.times[0].reopenedAt, '2026-08-11T10:00:00.000Z');
  assert.equal(by.beta.has_poll_coverage, false);
  assert.deepEqual(by.beta.times, []);
  assert.equal(by.gamma.has_poll_coverage, false);
  assert.deepEqual(by.gamma.times, []);
});

test('snapshotNeedsLiveFill always refreshes for Find', () => {
  const now = Date.parse('2026-08-11T18:00:00.000Z');
  assert.equal(
    snapshotNeedsLiveFill(
      { has_poll_coverage: false, spots_known: true, last_polled_at: null, times: [] },
      2,
      '2026-08-12',
      now,
    ),
    true,
  );
  assert.equal(
    snapshotNeedsLiveFill(
      {
        has_poll_coverage: true,
        spots_known: true,
        last_polled_at: new Date(now - 60 * 1000).toISOString(),
        times: [{ id: '1', startsAt: '2026-08-12T20:00:00.000Z', holes: 18, spots: 4 }],
      },
      2,
      '2026-08-12',
      now,
    ),
    true,
  );
  assert.equal(
    snapshotNeedsLiveFill(
      {
        has_poll_coverage: true,
        spots_known: true,
        last_polled_at: new Date(now - 60 * 1000).toISOString(),
        times: [],
      },
      2,
      '2026-08-12',
      now,
    ),
    true,
  );
});

test('normalizedRowsToBatchTimes filters players/holes and builds startsAt', () => {
  const playDate = '2099-06-01';
  const times = normalizedRowsToBatchTimes(
    'stonebridge-west-valley-city',
    playDate,
    18,
    2,
    [
      { rawTime: '14:06', spots: 3, price: '$45', holes: 18 },
      { rawTime: '14:15', spots: 1, price: '$45', holes: 18 },
      { rawTime: '09:00', spots: 4, price: '$30', holes: 9 },
    ],
  );
  assert.equal(times.length, 1);
  assert.equal(times[0].spots, 3);
  assert.ok(times[0].startsAt.includes('2099-06-01') || times[0].startsAt.startsWith('2099-'));
});

test('normalizedRowsToBatchTimes uses course timezone for wall clock', () => {
  const playDate = '2099-06-01';
  const mt = normalizedRowsToBatchTimes(
    'utah-course',
    playDate,
    18,
    1,
    [{ rawTime: '08:00', spots: 4, price: '$40', holes: 18 }],
    'America/Denver',
  );
  const pt = normalizedRowsToBatchTimes(
    'pacific-course',
    playDate,
    18,
    1,
    [{ rawTime: '08:00', spots: 4, price: '$40', holes: 18 }],
    'America/Los_Angeles',
  );
  assert.equal(mt.length, 1);
  assert.equal(pt.length, 1);
  // Same wall clock in Pacific is one hour later in UTC than Mountain (MDT vs PDT).
  assert.equal(
    new Date(pt[0].startsAt).getTime() - new Date(mt[0].startsAt).getTime(),
    60 * 60 * 1000,
  );
});
