import test from 'node:test';
import assert from 'node:assert/strict';
import { courseTimezoneFor, localParts, timezoneForCoordinates, withCourseTimezone } from './courseTimezone.js';
import { buildCandidatePairs, courseClocks, isBookingBurstWindow, isGolfHours } from './availabilityPoll.js';

test('split-zone states resolve by pin, not by state', () => {
  assert.equal(timezoneForCoordinates(30.44, -84.28), 'America/New_York'); // Tallahassee FL
  assert.equal(timezoneForCoordinates(30.42, -87.21), 'America/Chicago'); // Pensacola FL
  assert.equal(timezoneForCoordinates(31.76, -106.48), 'America/Denver'); // El Paso TX
  assert.equal(timezoneForCoordinates(32.78, -96.8), 'America/Chicago'); // Dallas TX
  assert.equal(timezoneForCoordinates(43.6, -116.2), 'America/Boise'); // Boise ID
  assert.equal(timezoneForCoordinates(47.67, -116.78), 'America/Los_Angeles'); // Coeur d'Alene ID
});

test('Arizona skips DST but the Navajo Nation does not', () => {
  assert.equal(timezoneForCoordinates(33.45, -112.07), 'America/Phoenix');
  assert.equal(timezoneForCoordinates(36.06, -109.2), 'America/Denver');
});

test('a missing or zero pin falls back to the stored zone, then Mountain Time', () => {
  assert.equal(timezoneForCoordinates(null, undefined), null);
  assert.equal(timezoneForCoordinates(0, 0), null);
  assert.equal(courseTimezoneFor({ timezone: 'America/Chicago' }), 'America/Chicago');
  assert.equal(courseTimezoneFor({ timezone: 'Not/AZone' }), 'America/Denver');
  assert.equal(courseTimezoneFor({}), 'America/Denver');
});

test('the pin wins over an old state-table guess', () => {
  // A Florida panhandle course that discovery stored as Mountain Time.
  const fixed = withCourseTimezone({ name: 'Pensacola', lat: 30.42, lng: -87.21, timezone: 'America/Denver' });
  assert.equal(fixed.timezone, 'America/Chicago');
  const same = { lat: 40.76, lng: -111.89, timezone: 'America/Denver' };
  assert.equal(withCourseTimezone(same), same);
});

test('local parts follow each zone across midnight', () => {
  // 05:30 UTC: 23:30 the day before in Denver, 01:30 in New York, 19:30 in Honolulu.
  const at = new Date('2026-07-04T05:30:00Z');
  assert.deepEqual(localParts('America/Denver', at), { dateYmd: '2026-07-03', hour: 23, minute: 30 });
  assert.deepEqual(localParts('America/New_York', at), { dateYmd: '2026-07-04', hour: 1, minute: 30 });
  assert.deepEqual(localParts('Pacific/Honolulu', at), { dateYmd: '2026-07-03', hour: 19, minute: 30 });
});

test('golf hours and the 8:00 burst are per course', () => {
  // 12:05 UTC in July: 08:05 New York, 06:05 Denver, 02:05 Honolulu.
  const at = new Date('2026-07-04T12:05:00Z');
  const courses = [
    { slug: 'east', lat: 40.71, lng: -74.0 },
    { slug: 'west', lat: 40.76, lng: -111.89 },
    { slug: 'hawaii', lat: 21.3, lng: -157.85 },
  ];
  const clocks = courseClocks(courses, at);
  assert.equal(clocks.get('east').hour, 8);
  assert.equal(isBookingBurstWindow(clocks.get('east')), true);
  assert.equal(isGolfHours(clocks.get('east')), true);
  assert.equal(isGolfHours(clocks.get('west')), true); // 06:05
  assert.equal(isBookingBurstWindow(clocks.get('west')), false);
  assert.equal(isGolfHours(clocks.get('hawaii')), false); // 02:05
});

test('each course gets its own 15-day window', () => {
  // 04:30 UTC: already July 4 in New York, still July 3 in Denver.
  const at = new Date('2026-07-04T04:30:00Z');
  const courses = [
    { slug: 'east', lat: 40.71, lng: -74.0 },
    { slug: 'west', lat: 40.76, lng: -111.89 },
  ];
  const pairs = buildCandidatePairs(courses, courseClocks(courses, at));
  const datesFor = (slug) => pairs.filter((p) => p.course_slug === slug).map((p) => p.play_date);
  assert.equal(datesFor('east').length, 15);
  assert.equal(datesFor('east')[0], '2026-07-04');
  assert.equal(datesFor('west')[0], '2026-07-03');
  assert.equal(datesFor('west').at(-1), '2026-07-17');
});

test('an exact zone stamped for this pin beats the coarse Worker lookup', () => {
  // Kellogg ID is Pacific; tz-lookup's grid says Mountain this close to the line.
  const kellogg = { lat: 47.5382212, lng: -116.1602605, timezone: 'America/Los_Angeles', timezone_pin: '47.5382,-116.1603' };
  assert.equal(courseTimezoneFor(kellogg), 'America/Los_Angeles');
  assert.equal(withCourseTimezone(kellogg), kellogg);
});

test('moving the pin drops the stamp and falls back to the Worker lookup', () => {
  const moved = { lat: 40.76, lng: -111.89, timezone: 'America/Los_Angeles', timezone_pin: '47.5382,-116.1603' };
  const next = withCourseTimezone(moved);
  assert.equal(next.timezone, 'America/Denver');
  assert.equal('timezone_pin' in next, false);
});

test('TeeSnap courses marked unsupported are not polled; other live vendors still are', async () => {
  const { isPollableCourse } = await import('./availabilityPoll.js');
  assert.equal(isPollableCourse({ platform: 'teesnap', booking_status: 'unsupported', booking_url: 'https://blackoakgolf.teesnap.net/' }), false);
  assert.equal(isPollableCourse({ platform: 'teesnap', booking_status: 'ready', booking_url: 'https://x.teesnap.net/' }), true);
  assert.equal(isPollableCourse({ platform: 'quick18', booking_status: 'unsupported', booking_url: 'https://lakehavasu.quick18.com/teetimes/searchmatrix' }), true);
  assert.equal(isPollableCourse({ platform: 'foreup', booking_status: 'pending' }), false);
  assert.equal(isPollableCourse({ platform: 'foreup', booking_status: 'ready' }), true);
});
