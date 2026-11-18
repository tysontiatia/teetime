import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIndexStub, crawlRetryPlan } from './courseIndexCrawl.js';

const primary = {
  course_key: 'c1:the-ridge', club_id: 'c1', club_name: "Mulligan's Golf and Game", course_name: 'The Ridge',
  state: 'UT', city: 'South Jordan', address: '692 W 10600 S, South Jordan, UT 84095', phone: '(801) 254-7500',
  website: 'http://www.mulligans-south.com/', timezone: 'America/Denver', timezone_pin: '40.5530,-111.9120',
  lat: 40.553, lng: -111.912, holes: 9, par: 27, yardage: 1100, tees: [{ name: 'White', gender: 'M', yards: 1100 }],
};
const layouts = [primary, { ...primary, course_key: 'c1:the-meadow', course_name: 'The Meadow' }];

test('a crawled tee sheet becomes a hidden QA stub with the index facts', () => {
  const hit = {
    support: 'live_ready', platform: 'foreup', booking_url: 'https://foreupsoftware.com/index.php/booking/123/456#/teetimes',
    hints: { schedule_id: '456' }, note: 'ForeUp tee sheet', og_image: 'https://mulligans-south.com/hero.jpg', editorial_note: 'Two 9-hole par-3 courses.',
  };
  const { slug, record } = buildIndexStub(primary, layouts, hit);
  assert.equal(slug, 'mulligan-s-golf-and-game-south-jordan');
  assert.equal(record.name, "Mulligan's Golf and Game (South Jordan)");
  assert.equal(record.booking_status, 'pending');
  assert.equal(record.platform, 'foreup');
  assert.equal(record.schedule_id, '456');
  assert.equal(record.area, 'Utah · South Jordan');
  assert.equal(record.timezone, 'America/Denver');
  assert.equal(record.timezone_pin, '40.5530,-111.9120');
  assert.deepEqual(record.index_layouts, ['The Ridge', 'The Meadow']);
  assert.equal(record.birdies_club_id, 'c1');
  assert.equal(record.photo_candidate_url, 'https://mulligans-south.com/hero.jpg');
  assert.match(record.booking_status_note, /also lists The Meadow/);
  assert.equal('google_place_id' in record, false);
});

test('a site that did not load still yields a stub, marked for a person to finish', () => {
  const { record } = buildIndexStub(primary, [primary], { support: 'fetch_failed', note: 'timeout' });
  assert.equal(record.booking_status, 'pending');
  assert.equal(record.platform, '');
  assert.match(record.booking_status_note, /did not load/);
});

test('retries wait 1 h, then 6 h, then stop', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  assert.equal(crawlRetryPlan(0, now), '2026-11-18T13:00:00.000Z');
  assert.equal(crawlRetryPlan(1, now), '2026-11-18T18:00:00.000Z');
  assert.equal(crawlRetryPlan(2, now), null);
});
