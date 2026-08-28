import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBookingUrl } from './courseAdmin.js';

test('parseBookingUrl maps live and backlog vendor hosts', () => {
  assert.equal(parseBookingUrl('https://foreupsoftware.com/booking/123/456').platform, 'foreup');
  assert.equal(parseBookingUrl('https://www.golfnow.com/tee-times/facility/2042').platform, 'golfnow');
  assert.equal(parseBookingUrl('https://www.ezlinksgolf.com/index.cfm?action=club').platform, 'ezlinks');
  assert.equal(parseBookingUrl('https://app.teesnap.com/book/abc').platform, 'teesnap');
  assert.equal(parseBookingUrl('https://www.clubessential.com/foo').platform, 'clubessentials');
  assert.equal(parseBookingUrl('https://book.teeoff.com/course/1').platform, 'teeoff');
  assert.equal(
    parseBookingUrl('https://www.golfrev.com/go/tee_times/?htc=363&courseid=4048&r=1').platform,
    'golfrev',
  );
  assert.equal(
    parseBookingUrl('https://www.golfrev.com/go/tee_times/?htc=363&courseid=4048&r=1').hints.golfrev_course_id,
    '4048',
  );
  assert.equal(
    parseBookingUrl('https://augustaranch.play18.com/teetimes/searchmatrix').platform,
    'sagacity',
  );
  assert.equal(parseBookingUrl('https://www.sagacitygolf.com/').platform, 'sagacity');
  assert.equal(parseBookingUrl('https://random-muni.example.com/tee-times').platform, null);
});
