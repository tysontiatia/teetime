/**
 * Unit tests for batched /v1/tee-times helpers (no PostgREST).
 * Run: `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTeeTimesBySlug,
  countPeekDays,
  liveFillAttemptTimeoutMs,
  normalizedRowsToBatchTimes,
  parseTeeTimesIds,
  postgrestInList,
  snapshotNeedsBlockingLiveFill,
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

test('buildTeeTimesBySlug keeps stale slots when home asks for a count', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const stale = new Date(Date.now() - 9 * 60 * 1000).toISOString();
  const by = buildTeeTimesBySlug(
    ['ridge'],
    [{ course_slug: 'ridge', last_success_at: stale }],
    [
      {
        id: 'earlier',
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
    1,
    { keepStale: true },
  );
  assert.equal(by.ridge.times.length, 1);
  assert.equal(by.ridge.times[0].id, 'earlier');
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
  assert.equal(
    snapshotNeedsLiveFill(covered(60 * 1000, hotTimes), 2, '2026-08-12', now, true),
    true,
    'forceFresh live-fills even a 1-minute-old snapshot',
  );
});

test('snapshotNeedsBlockingLiveFill waits only for miss/empty/unknown age', () => {
  const now = Date.parse('2026-08-11T18:00:00.000Z');
  const hotTimes = [{ id: '1', startsAt: '2026-08-12T20:00:00.000Z', holes: 18, spots: 4 }];
  const covered = (ageMs, times) => ({
    has_poll_coverage: true,
    spots_known: true,
    last_polled_at: new Date(now - ageMs).toISOString(),
    times,
  });

  assert.equal(
    snapshotNeedsBlockingLiveFill(
      { has_poll_coverage: false, spots_known: true, last_polled_at: null, times: [] },
      2,
      '2026-08-12',
      now,
    ),
    true,
    'no coverage must block',
  );
  assert.equal(
    snapshotNeedsBlockingLiveFill(covered(60 * 1000, []), 2, '2026-08-12', now),
    true,
    'empty sheet must block so Find does not paint a fake sold-out',
  );
  assert.equal(
    snapshotNeedsBlockingLiveFill(covered(20 * 60 * 1000, hotTimes), 2, '2026-08-12', now),
    false,
    'stale non-empty snapshot must not hold the batch — client revalidates',
  );
  assert.equal(
    snapshotNeedsLiveFill(covered(20 * 60 * 1000, hotTimes), 2, '2026-08-12', now),
    true,
    'stale non-empty is still considered refreshable',
  );
  assert.equal(
    snapshotNeedsBlockingLiveFill(
      { has_poll_coverage: true, spots_known: true, last_polled_at: null, times: hotTimes },
      2,
      '2026-08-12',
      now,
    ),
    true,
    'unknown age still blocks',
  );
  assert.equal(
    snapshotNeedsBlockingLiveFill(covered(60 * 1000, hotTimes), 2, '2026-08-12', now, true),
    true,
    'forceFresh still blocks',
  );
});

test('liveFillAttemptTimeoutMs skips when the Find budget is gone', () => {
  const now = 1_000_000;
  assert.equal(liveFillAttemptTimeoutMs(12_000, null, now), 12_000);
  assert.equal(liveFillAttemptTimeoutMs(12_000, now + 3_000, now), 3_000);
  assert.equal(liveFillAttemptTimeoutMs(12_000, now + 200, now), 0);
  assert.equal(liveFillAttemptTimeoutMs(12_000, now - 1, now), 0);
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

test('countPeekDays keeps the next day that fits players and time of day', () => {
  const now = Date.parse('2026-11-05T18:00:00.000Z');
  const days = countPeekDays(
    [
      {
        play_date: '2026-11-06',
        play_starts_at: '2026-11-06T15:00:00.000Z',
        starts_at_local: '08:00:00',
        spots_open: 1,
      },
      {
        play_date: '2026-11-06',
        play_starts_at: '2026-11-06T20:00:00.000Z',
        starts_at_local: '13:00:00',
        spots_open: 4,
      },
      {
        play_date: '2026-11-07',
        play_starts_at: '2026-11-07T15:10:00.000Z',
        starts_at_local: '08:10:00',
        spots_open: 4,
      },
      {
        play_date: '2026-11-07',
        play_starts_at: '2026-11-07T15:20:00.000Z',
        starts_at_local: '08:20:00',
        spots_open: 4,
      },
      {
        play_date: '2026-11-04',
        play_starts_at: '2026-11-04T15:00:00.000Z',
        starts_at_local: '08:00:00',
        spots_open: 4,
      },
    ],
    2,
    'morning',
    now,
  );
  assert.deepEqual(days, [{ date: '2026-11-07', count: 2 }]);
});

test('a sheet past its booking window comes back as a confirmed empty day with the window', async () => {
  const { liveFillTeeTimesBatch } = await import('./availabilityRead.js');
  const by_slug = {};
  const deps = {
    loadCourses: async () => [{ slug: 'c', name: 'C', platform: 'foreup', timezone: 'America/Denver' }],
    fetchTimesForCourse: async () => ({ error: 'booking_range', booking_window_days: 14, booking_opens_time: '07:00' }),
    normalizeTimesWorker: () => [],
  };
  const result = await liveFillTeeTimesBatch(by_slug, ['c'], '2026-12-28', 18, 2, deps, { forceFresh: true });
  assert.deepEqual(result, { filled: 1, failed: 0 });
  assert.equal(by_slug.c.source, 'live');
  assert.equal(by_slug.c.live_failed, false);
  assert.deepEqual(by_slug.c.times, []);
  assert.equal(by_slug.c.booking_window_days, 14);
  assert.equal(by_slug.c.booking_opens_time, '07:00');
});

test('any other vendor error is still a failed fill', async () => {
  const { liveFillTeeTimesBatch } = await import('./availabilityRead.js');
  const by_slug = {};
  const deps = {
    loadCourses: async () => [{ slug: 'c', name: 'C', platform: 'foreup' }],
    fetchTimesForCourse: async () => ({ error: 'upstream_error' }),
    normalizeTimesWorker: () => [],
  };
  const result = await liveFillTeeTimesBatch(by_slug, ['c'], '2026-12-28', 18, 2, deps, { forceFresh: true });
  assert.deepEqual(result, { filled: 0, failed: 1 });
  assert.equal(by_slug.c.live_failed, true);
});
