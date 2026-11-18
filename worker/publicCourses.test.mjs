import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDEX_COURSE_FIELDS,
  PRIVATE_COURSE_FIELDS,
  coverageFromCourses,
  indexCourse,
  parseSlugList,
  publicCourse,
} from './publicCourses.js';

const clubcaddie = {
  slug: 'bennett-valley-golf-course-santa-rosa',
  name: 'Bennett Valley Golf Course (Santa Rosa)',
  state: 'CA',
  platform: 'clubcaddie',
  booking_url: 'https://apimanager-cc12.clubcaddie.com/webapi/view/abcdef123/slots',
  clubcaddie_apikey: 'abcdef123',
  golfrev_htc: 'x',
  timezone: 'America/Los_Angeles',
  timezone_pin: '38.4300,-122.6600',
  editorial_note: 'A long note about the course.',
  phone_number: '(707) 555-0100',
  schedule_id: '42',
};

test('public records drop vendor credentials and internal fields only', () => {
  const out = publicCourse(clubcaddie);
  for (const key of PRIVATE_COURSE_FIELDS) assert.equal(key in out, false, key);
  assert.equal(out.booking_url, clubcaddie.booking_url);
  assert.equal(out.schedule_id, '42');
  assert.equal(out.editorial_note, clubcaddie.editorial_note);
  assert.equal('clubcaddie_apikey' in clubcaddie, true, 'the input is not mutated');
});

test('the index keeps list fields and leaves detail and vendor ids out', () => {
  const out = indexCourse(clubcaddie);
  assert.deepEqual(Object.keys(out).sort(), ['booking_url', 'name', 'platform', 'slug', 'state', 'timezone']);
  for (const key of Object.keys(out)) assert.ok(INDEX_COURSE_FIELDS.includes(key));
  for (const key of PRIVATE_COURSE_FIELDS) assert.equal(key in out, false);
});

test('slug lists are trimmed, lower-cased, de-duplicated, and validated', () => {
  assert.deepEqual(parseSlugList(' A-1 ,a-1,b_2,c-3,,'), ['a-1', 'c-3']);
  assert.deepEqual(parseSlugList(null), []);
});

test('coverage counts states and marks live ones at 5+ courses', () => {
  const courses = [
    ...Array.from({ length: 6 }, () => ({ state: 'UT' })),
    ...Array.from({ length: 5 }, () => ({ state: 'id' })),
    { state: 'WY' },
    { state: '' },
  ];
  const coverage = coverageFromCourses(courses);
  assert.equal(coverage.total_courses, 13);
  assert.deepEqual(coverage.states, [
    { state: 'UT', courses: 6 },
    { state: 'ID', courses: 5 },
    { state: 'WY', courses: 1 },
  ]);
  assert.deepEqual(coverage.live_states, ['UT', 'ID']);
});

test('with no state at 5+, the largest state is still named', () => {
  assert.deepEqual(coverageFromCourses([{ state: 'WY' }, { state: 'WY' }, { state: 'MT' }]).live_states, ['WY']);
});

test('coverage names the most-reviewed course with a stored photo as the hero', () => {
  const hero = coverageFromCourses([
    { slug: 'a', name: 'A', state: 'UT', review_count: 900 },
    { slug: 'b', name: 'B', state: 'UT', review_count: 300, photo_storage_url: 'https://img/b.jpg' },
    { slug: 'c', name: 'C', state: 'UT', review_count: 500, photo_storage_url: 'https://img/c.jpg' },
  ]).hero;
  assert.deepEqual(hero, { slug: 'c', name: 'C', photo_storage_url: 'https://img/c.jpg' });
  assert.equal(coverageFromCourses([{ state: 'UT' }]).hero, null);
});
