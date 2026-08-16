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
  const seenFresh = new Date().toISOString();
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
        last_seen_at: seenFresh,
      },
      {
        id: '2',
        course_slug: 'alpha',
        play_starts_at: future,
        starts_at_local: '14:30:00',
        price_cents: 4700,
        spots_open: 1,
        holes: 18,
        last_seen_at: seenFresh,
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

test('buildTeeTimesBySlug hides open slots not seen recently (close-debounce ghosts)', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const fresh = new Date().toISOString();
  const stale = new Date(Date.now() - 9 * 60 * 1000).toISOString();
  const by = buildTeeTimesBySlug(
    ['ridge'],
    [{ course_slug: 'ridge', last_success_at: fresh }],
    [
      {
        id: 'live',
        course_slug: 'ridge',
        play_starts_at: future,
        starts_at_local: '17:10:00',
        price_cents: 5500,
        spots_open: 2,
        holes: 18,
        last_seen_at: fresh,
      },
      {
        id: 'ghost',
        course_slug: 'ridge',
        play_starts_at: future,
        starts_at_local: '13:30:00',
        price_cents: 5500,
        spots_open: 4,
        holes: 18,
        last_seen_at: stale,
      },
    ],
    [],
    2,
  );
  assert.equal(by.ridge.times.length, 1);
  assert.equal(by.ridge.times[0].id, 'live');
});

test('snapshotNeedsLiveFill live-fills misses, empty sheets, and stale snapshots', () => {
  // MT calendar date for this instant is 2026-08-11 (noon Denver).
  const now = Date.parse('2026-08-11T18:00:00.000Z');
  const hotTimes = [{ id: '1', startsAt: '2026-08-12T20:00:00.000Z', holes: 18, spots: 4 }];
  const covered = (ageMs, times) => ({
    has_poll_coverage: true,
    spots_known: true,
    last_polled_at: new Date(now - ageMs).toISOString(),
    times,
  });

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
    snapshotNeedsLiveFill(covered(60 * 1000, hotTimes), 2, '2026-08-12', now),
    false,
    'fresh non-empty hot snapshot should not live-fill',
  );
  assert.equal(
    snapshotNeedsLiveFill(covered(60 * 1000, []), 2, '2026-08-12', now),
    true,
    'empty sheet always live-fills',
  );
  assert.equal(
    snapshotNeedsLiveFill(covered(8 * 60 * 1000, hotTimes), 2, '2026-08-12', now),
    false,
    'hot snapshot at exactly 8m max age is still trusted',
  );
  assert.equal(
    snapshotNeedsLiveFill(covered(8 * 60 * 1000 + 1, hotTimes), 2, '2026-08-12', now),
    true,
    'hot snapshot older than 8m must live-fill (ghost / sold-out chips)',
  );
  assert.equal(
    snapshotNeedsLiveFill(covered(20 * 60 * 1000, hotTimes), 2, '2026-08-12', now),
    true,
    'stale hot-date snapshot must live-fill',
  );
  // Warm date (+4 days): 8–25m ages stay on snapshot; only beyond warm max live-fills.
  assert.equal(
    snapshotNeedsLiveFill(covered(20 * 60 * 1000, hotTimes), 2, '2026-08-15', now),
    false,
    'warm-date snapshot under 25m should not live-fill',
  );
  assert.equal(
    snapshotNeedsLiveFill(covered(25 * 60 * 1000 + 1, hotTimes), 2, '2026-08-15', now),
    true,
    'warm-date snapshot older than 25m must live-fill',
  );
  assert.equal(
    snapshotNeedsLiveFill(
      {
        has_poll_coverage: true,
        spots_known: true,
        last_polled_at: null,
        times: hotTimes,
      },
      2,
      '2026-08-12',
      now,
    ),
    true,
    'unknown last_polled_at must live-fill',
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
