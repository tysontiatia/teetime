import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  buildQuick18BookingUrl,
  holesFromScheduleHeader,
  normalizeQuick18TimesWorker,
  parseQuick18SearchMatrix,
  courseHasQuick18Sheet,
  quick18CourseId,
  quick18SheetHost,
  quick18StampToRawTime,
  quick18Tenant,
  ymdToQuick18Date,
} from './quick18.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const papago = readFileSync(resolve(__dirname, 'quick18.fixture.html'), 'utf8');
const grayhawk = readFileSync(resolve(__dirname, 'quick18.grayhawk.fixture.html'), 'utf8');

test('tenant and course id resolve from record or booking host', () => {
  assert.equal(quick18Tenant({ quick18_tenant: 'Papago' }), 'papago');
  assert.equal(
    quick18Tenant({ booking_url: 'https://papago.quick18.com/teetimes/searchmatrix' }),
    'papago',
  );
  assert.equal(quick18Tenant({ booking_url: 'https://example.com' }), '');
  assert.equal(
    quick18Tenant({ booking_url: 'https://augustaranch.play18.com/teetimes/searchmatrix' }),
    'augustaranch',
  );
  assert.equal(
    quick18SheetHost({ booking_url: 'https://augustaranch.play18.com/teetimes/searchmatrix' }),
    'augustaranch.play18.com',
  );
  assert.equal(courseHasQuick18Sheet({ platform: 'sagacity', booking_url: 'https://augustaranch.play18.com/teetimes/searchmatrix' }), true);
  assert.equal(courseHasQuick18Sheet({ platform: 'sagacity', booking_url: 'https://www.sagacitygolf.com/' }), false);
  assert.equal(quick18CourseId({ quick18_course_id: '1057' }), '1057');
  assert.equal(quick18CourseId({ quick18_course_id: 'x' }), '');
});

test('date stamp helpers', () => {
  assert.equal(ymdToQuick18Date('2026-09-01'), '20260901');
  assert.equal(quick18StampToRawTime('202609010620'), '2026-09-01 06:20');
  assert.equal(holesFromScheduleHeader('27 Hole Rate'), null);
  assert.equal(holesFromScheduleHeader('Public - Riding'), 18);
  assert.equal(holesFromScheduleHeader('9 Hole Walking'), 9);
});

test('Papago matrix emits 18-hole rows with spots and dollars', () => {
  const rows = parseQuick18SearchMatrix(papago, { dateYmd: '2026-09-01' });
  assert.equal(rows.length, 2);
  const first = rows.find((r) => r.rawTime === '2026-09-01 06:20');
  assert.ok(first);
  assert.equal(first.holes, 18);
  assert.equal(first.spots, 1);
  assert.equal(first.price, '$106');
  const four = rows.find((r) => r.rawTime === '2026-09-01 06:30');
  assert.equal(four.spots, 4);
});

test('Grayhawk keeps 18-hole rates and skips 27/36 packages', () => {
  const rows = parseQuick18SearchMatrix(grayhawk, { dateYmd: '2026-09-01' });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.holes === 18));
  const raptor = rows.find((r) => r.rawTime === '2026-09-01 06:48');
  assert.equal(raptor.price, '$173');
  assert.equal(raptor.spots, 2);
});

test('optional course id filters a multi-course tenant', () => {
  const talon = parseQuick18SearchMatrix(grayhawk, { dateYmd: '2026-09-01', courseId: '24' });
  assert.equal(talon.length, 1);
  assert.equal(talon[0].rawTime, '2026-09-01 11:00');
  assert.equal(talon[0].price, '$145');
});

test('normalize reads html or pre-parsed times; errors are empty', () => {
  const fromHtml = normalizeQuick18TimesWorker({}, { html: papago, date: '2026-09-01' });
  assert.equal(fromHtml.length, 2);
  const fromTimes = normalizeQuick18TimesWorker({}, { times: fromHtml });
  assert.equal(fromTimes.length, 2);
  assert.deepEqual(normalizeQuick18TimesWorker({}, { error: 'nope' }), []);
  assert.deepEqual(normalizeQuick18TimesWorker({}, {}), []);
  assert.deepEqual(normalizeQuick18TimesWorker({}, null), []);
});

test('booking URL stamps teedate on the tenant host', () => {
  assert.equal(
    buildQuick18BookingUrl(
      { booking_url: 'https://papago.quick18.com/teetimes/searchmatrix' },
      '2026-09-01',
    ),
    'https://papago.quick18.com/teetimes/searchmatrix?teedate=20260901',
  );
  assert.equal(
    buildQuick18BookingUrl({ quick18_tenant: 'papago' }, '2026-09-01'),
    'https://papago.quick18.com/teetimes/searchmatrix?teedate=20260901',
  );
  assert.equal(
    buildQuick18BookingUrl(
      { booking_url: 'https://augustaranch.play18.com/teetimes/searchmatrix' },
      '2026-09-01',
    ),
    'https://augustaranch.play18.com/teetimes/searchmatrix?teedate=20260901',
  );
});
