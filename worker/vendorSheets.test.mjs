import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForeUpFacilityPlace, parseForeUpSchedules, planClubStubs, sheetForName } from './vendorSheets.js';

const layout = (club, course, extra = {}) => ({ club_name: club, course_name: course, course_key: `${club}:${course}`, layout_kind: 'main', state: 'UT', city: '', ...extra });

test('ForeUp schedules and facility place are read from the booking page', () => {
  const html = 'var SCHEDULES = [{"teesheet_id":"8401","title":"The Meadow- Par 3 Course","holes":"9","online_booking":"1"},{"teesheet_id":"9785","title":"Sim 2024","holes":"18","online_booking":"0"}];' +
    ' COURSE = {"name":"Mulligans Golf & Games","city":"South Jordan","state":"UT"}';
  assert.deepEqual(parseForeUpSchedules(html), [
    { id: '8401', name: 'The Meadow- Par 3 Course', holes: 9, online: true },
    { id: '9785', name: 'Sim 2024', holes: 18, online: false },
  ]);
  assert.deepEqual(parseForeUpFacilityPlace(html), { city: 'South Jordan', state: 'UT' });
});

test("Mulligan's two layouts on two ForeUp sheets become two courses", () => {
  const meadow = layout("Mulligan's Golf and Game", 'The Meadow', { city: 'South Jordan' });
  const ridge = layout("Mulligan's Golf and Game", 'The Ridge', { city: 'South Jordan' });
  const plan = planClubStubs(ridge, [ridge, meadow], {
    sheets: [{ id: '8401', name: 'The Meadow- Par 3 Course' }, { id: '8400', name: 'The Ridge- Executive Course' }],
    accountName: 'Mulligans Golf & Games',
    accountPlace: { city: 'South Jordan', state: 'UT' },
  });
  assert.equal(plan.reject, undefined);
  assert.deepEqual(plan.plans.map((p) => [p.layout.course_name, p.sheet.id]).sort(), [['The Meadow', '8401'], ['The Ridge', '8400']]);
});

test("a link to another club's account is rejected by name", () => {
  const redmond = layout('The Golf Club at Redmond Ridge', 'Redmond Ridge', { state: 'WA', city: 'Redmond' });
  const plan = planClubStubs(redmond, [redmond], {
    sheets: [{ id: '17058', name: 'Links' }, { id: '17059', name: 'Woodlands' }],
    accountName: 'The Golf Club at Hawks Prairie',
    accountPlace: { city: 'Lacey', state: 'WA' },
  });
  assert.match(plan.reject, /does not match The Golf Club at Redmond Ridge/);
});

test('an account in another state is rejected even when the names fit', () => {
  const petaluma = layout('Adobe Creek Golf Club', 'Adobe Creek', { state: 'CA', city: 'Petaluma' });
  const plan = planClubStubs(petaluma, [petaluma], {
    sheets: [{ id: '12592', name: 'Adobe Creek 27' }],
    accountName: 'Adobe Creek National Golf Course',
    accountPlace: { city: 'Fruita', state: 'CO' },
  });
  assert.match(plan.reject, /is in CO, not CA/);
});

test('a single-course club takes the sheet named for it, and notes a different city', () => {
  const dm = layout('Dad Miller Golf Course', 'Dad Miller', { state: 'CA', city: 'Anaheim' });
  const plan = planClubStubs(dm, [dm], { sheets: [{ id: '1236', name: 'Anaheim Hills Golf Course' }, { id: '5240', name: 'Dad Miller Golf Course' }] });
  assert.equal(plan.plans[0].sheet.id, '5240');
  const other = planClubStubs(dm, [dm], { sheets: [{ id: '5240', name: 'Dad Miller Golf Course' }], accountName: 'Dad Miller Golf Course', accountPlace: { city: 'Fullerton', state: 'CA' } });
  assert.match(other.plans[0].note, /account is in Fullerton/);
});

test('vendors that do not list sheets keep the crawled link as one course', () => {
  const x = layout('Some Club', 'Some Club');
  assert.deepEqual(planClubStubs(x, [x], {}), { plans: [{ layout: x, sheet: null, note: '' }] });
});

test('sheet names that leave out the club still fit', () => {
  const sheets = [{ id: '16313', name: 'Championship' }, { id: '23670', name: 'The Links' }];
  assert.equal(sheetForName('Sand Hollow Links (Hurricane)', sheets, { clubName: 'Sand Hollow', registry: true }).id, '23670');
});
