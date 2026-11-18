import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bookingRange,
  daysInAdvance,
  foreupWindowDaysFromHtml,
  isPastBookingWindow,
  teeItUpBookingRange,
} from './bookingRange.js';

test('days in advance covers chronogolf, golfrev, and golfpay wording', () => {
  assert.equal(
    daysInAdvance('You are out of your booking range. The player type "Public" can only book 7 days in advance.'),
    7,
  );
  assert.equal(
    daysInAdvance('Guests are allowed to book a tee time 7 days in advance. Please check back within this time-frame.'),
    7,
  );
  assert.equal(daysInAdvance('This course only allows bookings up to 1 day in advance'), 1);
  assert.equal(daysInAdvance('at least 48 hours in advance'), null);
});

test('teeitup message becomes a window counted back from the play date', () => {
  const range = teeItUpBookingRange(
    'Tee times will be available to book from Friday, November 20, 2026 at 5:01 AM',
    '2026-12-20',
  );
  assert.deepEqual(range, {
    error: 'booking_range',
    booking_window_days: 30,
    booking_opens_time: '5:01 AM',
  });
});

test('foreup window is the public booking class, not the tee sheet default', () => {
  const html =
    '{"teesheet_id":"2034","days_in_booking_window":"7","booking_classes":[{"booking_class_id":"2113","teesheet_id":"2034","days_in_booking_window":"21"}]}';
  assert.equal(foreupWindowDaysFromHtml(html, '2113'), 21);
  assert.equal(foreupWindowDaysFromHtml(html, '999'), null);
  assert.equal(foreupWindowDaysFromHtml(html, ''), null);
});

test('a day on the edge of the window is still open', () => {
  assert.equal(isPastBookingWindow('2026-11-22', 7, '2026-11-15'), false);
  assert.equal(isPastBookingWindow('2026-11-23', 7, '2026-11-15'), true);
});

test('midnight is not a release clock', () => {
  assert.deepEqual(bookingRange(7, '0000'), { error: 'booking_range', booking_window_days: 7 });
  assert.equal(bookingRange(7, '06:00').booking_opens_time, '06:00');
});
