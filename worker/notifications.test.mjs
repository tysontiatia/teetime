import test from 'node:test';
import assert from 'node:assert/strict';
import { evalDatesForPref, slotNotifyKey } from './notifications.js';

test('evalDatesForPref returns specific target_date when in the future', () => {
  const dates = evalDatesForPref(
    { target_date: '2026-08-27', look_ahead_days: null },
    '2026-08-26',
  );
  assert.deepEqual(dates, ['2026-08-27']);
});

test('evalDatesForPref ignores past specific dates', () => {
  const dates = evalDatesForPref(
    { target_date: '2026-08-20', look_ahead_days: null },
    '2026-08-26',
  );
  assert.deepEqual(dates, []);
});

test('evalDatesForPref weekly returns up to 3 matching DOW dates', () => {
  // 2026-08-26 is Wednesday (3). Prefer Saturdays (6).
  const dates = evalDatesForPref(
    {
      target_date: null,
      look_ahead_days: 14,
      days_of_week: [6],
    },
    '2026-08-26',
  );
  assert.equal(dates.length, 2);
  assert.equal(dates[0], '2026-08-29');
  assert.equal(dates[1], '2026-09-05');
});

test('slotNotifyKey normalizes local times', () => {
  assert.equal(slotNotifyKey('11:51', 18), '11:51:00|18');
  assert.equal(slotNotifyKey('9:05:00', 9), '09:05:00|9');
});
