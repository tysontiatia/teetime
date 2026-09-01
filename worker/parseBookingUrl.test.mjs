import test from 'node:test';
import assert from 'node:assert/strict';
import { nextRecordPlatform, parseBookingUrl, recordAfterPlatformReclassify } from './courseAdmin.js';

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
    'quick18',
  );
  assert.equal(
    parseBookingUrl('https://augustaranch.play18.com/teetimes/searchmatrix').hints.quick18_tenant,
    'augustaranch',
  );
  assert.equal(parseBookingUrl('https://www.sagacitygolf.com/').platform, 'sagacity');
  assert.equal(parseBookingUrl('https://canyons.quick18.com/teetimes/searchmatrix').platform, 'quick18');
  assert.equal(parseBookingUrl('https://canyons.quick18.com/teetimes/searchmatrix').hints.quick18_tenant, 'canyons');
  assert.equal(
    parseBookingUrl('https://golfwithaccess.com/course/wohali/reserve-tee-time').platform,
    'golfwithaccess',
  );
  assert.equal(parseBookingUrl('https://www.golfrev.com/go/tee_times/?htc=370&courseid=3719&r=1').platform, 'golfrev');
  assert.equal(parseBookingUrl('https://book.onagilysys.com/onecart/golf/courses/1450/CDACASINO').platform, 'rguest');
  assert.equal(parseBookingUrl('https://book.rguest.com/onecart/golf/courses/1986/TamarackResort').platform, 'rguest');
  assert.equal(parseBookingUrl('https://brydencanyon.totaleintegrated.net/web/tee-times').platform, 'totaleintegrated');
  assert.equal(parseBookingUrl('https://apimanager-cc29.clubcaddie.com/webapi/view/cafdabab/slots').platform, 'clubcaddie');
  assert.equal(parseBookingUrl('https://mirrorlakegc.teesnap.net/').platform, 'teesnap');
  assert.equal(parseBookingUrl('https://idahoclub.ezlinksgolf.com/search').platform, 'ezlinks');
  assert.equal(
    parseBookingUrl('https://loscaballerosgc.clubhouseonline-e3.club/').platform,
    'clubhouseonline',
  );
  assert.equal(parseBookingUrl('https://course.golfscape.com/125e71/united-states/st-george').platform, 'golfscape');
  assert.equal(parseBookingUrl('https://fareharbor.com/embeds/book/silvermt/items/').platform, 'fareharbor');
  assert.equal(parseBookingUrl('https://app.easyteegolf.com/course/schneiter/').platform, 'easyteegolf');
  assert.equal(parseBookingUrl('https://idboiseweb.myvscloud.com/webtrac/web/search.html').platform, 'vscloud');
  assert.equal(
    parseBookingUrl('https://secure.west.prophetservices.com/TheLinksGolfv3/Home/nIndex').platform,
    'prophetservices',
  );
  assert.equal(parseBookingUrl('https://valorclubs.com/A_master/ui/publicteetime/dashboard.aspx').platform, 'valorclubs');
  assert.equal(
    parseBookingUrl('https://cdaresort.floatinggreensoftware.com/courses?date=2026-08-13').platform,
    'floatinggreen',
  );
  assert.equal(parseBookingUrl('https://www.agavehighlands.com/book-online').platform, null);
  assert.equal(parseBookingUrl('https://random-muni.example.com/tee-times').platform, null);
});

test('nextRecordPlatform recategorizes other from booking URL and leaves live adapters', () => {
  assert.deepEqual(
    nextRecordPlatform({
      platform: 'other',
      booking_url: 'https://www.golfrev.com/go/tee_times/?htc=370&courseid=3719',
    }),
    { platform: 'golfrev', from: 'other', changed: true, reason: 'url' },
  );
  assert.deepEqual(
    nextRecordPlatform({
      platform: 'sagacity',
      booking_url: 'https://birdieranch.quick18.com/teetimes/searchmatrix',
    }),
    { platform: 'quick18', from: 'sagacity', changed: true, reason: 'url' },
  );
  assert.deepEqual(
    nextRecordPlatform({
      platform: 'sagacity',
      booking_url: 'https://augustaranch.play18.com/teetimes/searchmatrix',
    }),
    { platform: 'quick18', from: 'sagacity', changed: true, reason: 'url' },
  );
  assert.deepEqual(
    nextRecordPlatform({
      platform: 'club',
      booking_url: 'https://loscaballerosgc.clubhouseonline-e3.club/',
    }),
    { platform: 'clubhouseonline', from: 'club', changed: true, reason: 'url' },
  );
  assert.equal(
    nextRecordPlatform({
      platform: 'foreup',
      booking_url: 'https://www.golfrev.com/go/tee_times/?htc=1',
    }).changed,
    false,
  );
  assert.equal(
    nextRecordPlatform({
      platform: 'other',
      booking_url: 'https://www.agavehighlands.com/book-online',
    }).changed,
    false,
  );
});

test('recordAfterPlatformReclassify stamps Play18 as live Quick18', () => {
  const next = nextRecordPlatform({
    platform: 'sagacity',
    booking_status: 'unsupported',
    booking_url: 'https://redmountain.play18.com/teetimes/searchmatrix',
  });
  const rec = recordAfterPlatformReclassify(
    {
      name: 'Red Mountain Ranch Country Club (Mesa)',
      platform: 'sagacity',
      booking_status: 'unsupported',
      booking_url: 'https://redmountain.play18.com/teetimes/searchmatrix',
    },
    next,
  );
  assert.equal(rec.platform, 'quick18');
  assert.equal(rec.booking_status, 'ready');
  assert.equal(rec.quick18_tenant, 'redmountain');
});
