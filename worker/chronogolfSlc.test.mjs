import test from 'node:test';
import assert from 'node:assert/strict';
import { chronogolfSlcCourseIds } from './chronogolfSlc.js';

test('chronogolfSlcCourseIds prefers course_ids when present', () => {
  assert.deepEqual(
    chronogolfSlcCourseIds({ course_id: '16290', course_ids: [16290, 16291] }),
    ['16290', '16291'],
  );
});

test('chronogolfSlcCourseIds falls back to single course_id', () => {
  assert.deepEqual(chronogolfSlcCourseIds({ course_id: '16310' }), ['16310']);
  assert.deepEqual(chronogolfSlcCourseIds({}), []);
});

test('chronogolfSlcCourseIds dedupes and stringifies', () => {
  assert.deepEqual(
    chronogolfSlcCourseIds({ course_ids: ['16290', 16290, '16291'] }),
    ['16290', '16291'],
  );
});
