import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogHolesFromChronogolfCourse } from './courseAdmin.js';

test('catalogHolesFromChronogolfCourse does not trust ambiguous bookableHoles', () => {
  // Forest Dale / Copper Club both advertise [9,18]; layout wins until manually verified.
  assert.equal(catalogHolesFromChronogolfCourse({ holes: 9, bookableHoles: [9, 18] }), 9);
  assert.equal(catalogHolesFromChronogolfCourse({ holes: 9, bookableHoles: [9] }), 9);
  assert.equal(catalogHolesFromChronogolfCourse({ holes: 18, bookableHoles: [18] }), 18);
  assert.equal(catalogHolesFromChronogolfCourse({ holes: 18, bookableHoles: [9, 18] }), 18);
  assert.equal(catalogHolesFromChronogolfCourse({}), null);
});
