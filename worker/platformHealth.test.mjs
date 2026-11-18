import test from 'node:test';
import assert from 'node:assert/strict';
import { healthEmail, summarizeHealth, vendorChange } from './platformHealth.js';

const now = Date.parse('2026-11-18T14:00:00Z');
const ago = (h) => new Date(now - h * 3600_000).toISOString();
const courses = [
  { slug: 'a', name: 'A', platform: 'teesnap' },
  { slug: 'b', name: 'B', platform: 'teesnap' },
  { slug: 'c', name: 'C', platform: 'teesnap' },
  { slug: 'd', name: 'D', platform: 'foreup', website: 'https://d.com' },
  { slug: 'e', name: 'E', platform: 'foreup' },
];

test('a platform with no success in 24 h is down; a long-failing course is listed', () => {
  const rows = [
    { course_slug: 'a', last_polled_at: ago(1), last_success_at: ago(24 * 60) },
    { course_slug: 'b', last_polled_at: ago(1), last_success_at: null },
    { course_slug: 'c', last_polled_at: ago(2), last_success_at: ago(24 * 5) },
    { course_slug: 'd', last_polled_at: ago(1), last_success_at: ago(80) },
    { course_slug: 'e', last_polled_at: ago(1), last_success_at: ago(1) },
    { course_slug: 'e', last_polled_at: ago(3), last_success_at: ago(30) },
  ];
  const { platforms, failing } = summarizeHealth(courses, rows, now);
  assert.deepEqual(platforms.map((p) => [p.platform, p.state, p.courses_ok, p.courses_polled]), [
    ['teesnap', 'down', 0, 3],
    ['foreup', 'ok', 1, 2],
  ]);
  assert.deepEqual(failing.map((f) => f.slug).sort(), ['a', 'b', 'c', 'd']);
});

test('a course not polled in the last day is not judged', () => {
  const { platforms, failing } = summarizeHealth(courses, [{ course_slug: 'e', last_polled_at: ago(30), last_success_at: null }], now);
  assert.deepEqual(platforms, []);
  assert.deepEqual(failing, []);
});

test('a crawled link on another vendor or host is a vendor change', () => {
  const course = { platform: 'teesnap', booking_url: 'https://lakehavasu.teesnap.net/' };
  assert.deepEqual(vendorChange(course, { platform: 'quick18', booking_url: 'https://lakehavasumember.quick18.com/' }), {
    platform: 'quick18', booking_url: 'https://lakehavasumember.quick18.com/',
  });
  assert.equal(vendorChange(course, { platform: 'teesnap', booking_url: 'https://lakehavasu.teesnap.net/x' }), null);
  assert.equal(vendorChange(course, { support: 'none' }), null);
});

test('the email is empty when all is well and names problems otherwise', () => {
  assert.equal(healthEmail({ platforms: [{ platform: 'foreup', state: 'ok' }], failing: [], suggestions: [] }), '');
  const html = healthEmail({
    platforms: [{ platform: 'teesnap', state: 'down', courses_ok: 0, courses_polled: 22 }],
    failing: [{ name: 'Black <Oak>', platform: 'teesnap', last_success_at: null }],
    suggestions: [{ name: 'Lake Havasu', platform: 'quick18', booking_url: 'https://lakehavasu.quick18.com/' }],
  });
  assert.match(html, /teesnap: down, 0 of 22/);
  assert.match(html, /Lake Havasu: now links to quick18/);
  assert.match(html, /Black &lt;Oak&gt;/);
});
