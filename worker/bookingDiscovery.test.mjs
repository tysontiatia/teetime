import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVendorEnrichment,
  classifyBookingUrl,
  crawlBookingSite,
  describeHit,
  discoverFromPages,
  extractCourseFacts,
  inspectHtml,
  looksBlocked,
  isLodgingBooking,
  outcomeFromCrawl,
  pageUnusable,
  platformsCompatible,
  supportFor,
  teeItUpFacilityIdFromHtml,
  toImportRecord,
} from './bookingDiscovery.js';
import { chronogolfClubPageUrl, normalizeImportStubRecord, selectForeUpScheduleId } from './courseAdmin.js';

const PAGE = 'https://example-golf.test/';

test('an unrecognized booking site is saved under its host', () => {
  const hit = describeHit({
    booking_url: 'https://tournaments-104128.square.site/book',
    platform: null,
    hints: {},
    support: 'unknown_vendor',
  });
  assert.equal(hit.platform, 'square.site');
  assert.equal(hit.booking_status, 'unsupported');
  assert.equal(hit.booking_url, 'https://tournaments-104128.square.site/book');
  const row = toImportRecord({ ...hit, name: 'Midnight Sun Golf Course (Fairbanks)' });
  assert.equal(row.record.platform, 'square.site');
  assert.equal(row.record.booking_url, hit.booking_url);
  assert.equal(row.record.booking_status, 'unsupported');
});

test('classifyBookingUrl reads ForeUp schedule ids and MemberSports path ids', () => {
  const foreup = classifyBookingUrl('https://foreupsoftware.com/index.php/booking/18950/609#/teetimes');
  assert.equal(foreup.platform, 'foreup');
  assert.equal(foreup.hints.schedule_id, '609');
  assert.equal(foreup.support, 'live_ready');

  const members = classifyBookingUrl('https://app.membersports.com/tee-times/15379/18889/0');
  assert.equal(members.platform, 'membersports');
  assert.equal(members.hints.golf_club_id, '15379');
  assert.equal(members.hints.golf_course_id, '18889');
  assert.equal(members.support, 'live_ready');
});

test('inspectHtml prefers a direct tee sheet over a vendor homepage and a GolfNow footer', () => {
  const html = `
    <a href="https://www.golfnow.com/">Find tee times</a>
    <a href="https://foreupsoftware.com/">ForeUp</a>
    <a href="https://foreupsoftware.com/index.php/booking/18950/7447#/teetimes">Book a tee time</a>
    <iframe src="https://www.chronogolf.com/club/bonneville-golf-course"></iframe>
  `;
  const found = inspectHtml(html, PAGE);
  const best = discoverFromPages([{ url: PAGE, html }]).best;
  assert.equal(best.platform, 'foreup');
  assert.equal(best.hints.schedule_id, '7447');
  assert.equal(best.support, 'live_ready');
  assert.equal(found.hits.some((hit) => hit.platform === 'chronogolf'), true);
  assert.equal(found.hits.some((hit) => hit.booking_url === 'https://www.golfnow.com/'), false);
  assert.equal(found.hits.some((hit) => hit.booking_url === 'https://foreupsoftware.com/'), false);
});

test('inspectHtml follows same-site tee time links and keeps unrecognized booking hosts', () => {
  const html = `
    <a href="/golf/tee-times">Tee Times</a>
    <a href="https://facebook.com/example">Book now</a>
    <a href="https://teesheets.example/course/42">Book a tee time</a>
  `;
  const found = inspectHtml(html, PAGE);
  assert.deepEqual(found.followups, ['https://example-golf.test/golf/tee-times']);
  assert.equal(found.unknowns.length, 1);
  assert.equal(found.unknowns[0].booking_url, 'https://teesheets.example/course/42');
  const best = discoverFromPages([{ url: PAGE, html }]).best;
  assert.equal(best.platform, 'teesheets.example');
  assert.equal(best.support, 'link_only');
  assert.equal(best.booking_status, 'unsupported');
});

test('escaped embed URLs and redirects are classified', () => {
  const html = `<script>var book="https:\\/\\/papago.quick18.com\\/teetimes\\/searchmatrix";</script>`;
  const fromHtml = discoverFromPages([{ url: PAGE, html }]).best;
  assert.equal(fromHtml.platform, 'quick18');
  assert.equal(fromHtml.hints.quick18_tenant, 'papago');
  assert.equal(fromHtml.support, 'live_ready');

  const fromRedirect = discoverFromPages([
    {
      url: 'https://example-golf.test/book',
      finalUrl: 'https://sundancegolfclub.teesnap.net/',
      html: '',
    },
  ]).best;
  assert.equal(fromRedirect.platform, 'teesnap');
  assert.equal(fromRedirect.via, 'redirect');
  assert.equal(fromRedirect.support, 'live_ready');
});

test('Chronogolf widget config becomes a club booking URL', () => {
  const html = `
    <script>window.chronogolfSettings = { "clubId" : 14158, "locale" : "en-US" };</script>
    <script src="https://cdn2.chronogolf.com/widgets/v2"></script>
  `;
  const best = discoverFromPages([{ url: PAGE, html }]).best;
  assert.equal(best.platform, 'chronogolf');
  assert.equal(best.hints.club_id, '14158');
  assert.equal(best.booking_url, 'https://www.chronogolf.com/club/14158');
  assert.equal(best.via, 'embed');
});

test('a single ForeUp teesheet id is kept during enrichment', () => {
  assert.equal(selectForeUpScheduleId('"teesheet_id":"674" "teesheet_id":"674"').schedule_id, '674');
  assert.equal(selectForeUpScheduleId('"teesheet_id":"1" "teesheet_id":"2"').schedule_id, null);
  const hit = classifyBookingUrl('https://foreupsoftware.com/index.php/booking/18950#/teetimes');
  assert.equal(hit.support, 'live_missing_ids');
  const enriched = applyVendorEnrichment(hit, { schedule_id: '674', booking_class_id: '4371' });
  assert.equal(enriched.support, 'live_ready');
  assert.equal(enriched.hints.schedule_id, '674');
  assert.equal(enriched.hints.booking_class_id, '4371');
});

test('Chronogolf enrichment fills club ids and promotes the club endpoint', () => {
  const hit = classifyBookingUrl('https://www.chronogolf.com/club/bonneville-golf-course');
  assert.equal(supportFor(hit.platform, hit.hints), 'live_missing_ids');
  const enriched = applyVendorEnrichment(
    { ...hit, via: 'anchor', evidence_page: PAGE },
    {
      club_id: '14222',
      course_id: '16310',
      course_ids: [16310],
      affiliation_type_id: '57710',
      booking_url: 'https://www.chronogolf.com/club/bonneville-golf-course',
      use_club_teetimes: true,
      meta: { holes: 18 },
    },
  );
  assert.equal(enriched.platform, 'chronogolf_slc');
  assert.equal(enriched.support, 'live_ready');
  assert.equal(enriched.booking_status, 'ready');
  assert.equal(enriched.holes, 18);
});

test('platformsCompatible treats Chronogolf club rows as the same vendor', () => {
  assert.equal(platformsCompatible('chronogolf', 'chronogolf_slc'), true);
  assert.equal(platformsCompatible('foreup', 'foreup_login'), true);
  assert.equal(platformsCompatible('foreup', 'quick18'), false);
});

test('crawlBookingSite opens one same-site tee time page', async () => {
  const pages = {
    'https://example-golf.test/': {
      url: 'https://example-golf.test/',
      finalUrl: 'https://example-golf.test/',
      status: 200,
      html: '<a href="/tee-times">Tee Times</a>',
    },
    'https://example-golf.test/tee-times': {
      url: 'https://example-golf.test/tee-times',
      finalUrl: 'https://example-golf.test/tee-times',
      status: 200,
      html: '<a href="https://foreupsoftware.com/index.php/booking/10/20">Book now</a>',
    },
  };
  const crawl = await crawlBookingSite('https://example-golf.test/', async (url) => pages[url]);
  assert.equal(crawl.best.platform, 'foreup');
  assert.equal(crawl.best.hints.schedule_id, '20');
  assert.equal(crawl.fetched.length, 2);
});

test('outcomeFromCrawl distinguishes a dead site from a site with no booking link', () => {
  assert.equal(outcomeFromCrawl({ best: null, fetched: [{ status: 0, error: 'timeout' }] }).support, 'fetch_failed');
  assert.equal(outcomeFromCrawl({ best: null, fetched: [{ status: 200 }] }).support, 'none');
  assert.equal(
    outcomeFromCrawl({
      best: null,
      fetched: [{ status: 202, blocked: true }],
    }).note,
    'The site blocked the fetch with a captcha.',
  );
  assert.equal(looksBlocked('<meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/">', 202), true);
});

test('toImportRecord keeps vendor ids for the admin import', () => {
  const row = toImportRecord({
    name: 'Bountiful Ridge (Bountiful)',
    area: 'Utah · Bountiful',
    platform: 'foreup',
    booking_url: 'https://foreupsoftware.com/index.php/booking/18950/7447#/teetimes',
    timezone: 'America/Denver',
    booking_status: 'ready',
    website: 'https://bountifulridgegolf.com/',
    hints: { schedule_id: '7447' },
    note: '',
  });
  assert.equal(row.slug, 'bountiful-ridge-bountiful');
  assert.equal(row.record.schedule_id, '7447');
  assert.equal(row.record.booking_status, 'ready');
  const withPhoto = toImportRecord({
    name: 'Bountiful Ridge (Bountiful)',
    photo_reference: 'places/abc/photos/photo-1',
  });
  assert.equal(withPhoto.record.photo_reference, 'places/abc/photos/photo-1');
});

test('normalizeImportStubRecord keeps discovery booking fields and still blanks CSV stubs', () => {
  const discovered = normalizeImportStubRecord({
    name: 'Bountiful Ridge (Bountiful)',
    area: 'Utah · Bountiful',
    platform: 'foreup',
    booking_url: 'https://foreupsoftware.com/index.php/booking/18950/7447',
    booking_status: 'ready',
    schedule_id: '7447',
    photo_reference: 'places/abc/photos/photo-1',
    timezone: 'America/Denver',
  });
  assert.equal(discovered.platform, 'foreup');
  assert.equal(discovered.schedule_id, '7447');
  assert.equal(discovered.photo_reference, 'places/abc/photos/photo-1');
  assert.equal(discovered.booking_status, 'ready');

  const stub = normalizeImportStubRecord({
    name: 'New Course (Boise)',
    area: 'Idaho',
    platform: '',
    booking_url: '',
    booking_status: 'pending',
    timezone: 'America/Boise',
  });
  assert.equal(stub.platform, '');
  assert.equal(stub.booking_url, '');
  assert.equal(stub.booking_status, 'pending');
});

test('a resort hotel Book Now is ignored and the golf page tee sheet is kept', async () => {
  assert.equal(isLodgingBooking('https://resnexus.com/resnexus/reservations/book/ABC', 'Book Now'), true);
  const pages = {
    'https://thelodgeresort.com/': {
      url: 'https://thelodgeresort.com/',
      finalUrl: 'https://thelodgeresort.com/',
      status: 200,
      html: `
        <a href="https://resnexus.com/resnexus/reservations/book/ABC">Book Now</a>
        <a href="/golf">Golf</a>
      `,
    },
    'https://thelodgeresort.com/golf': {
      url: 'https://thelodgeresort.com/golf',
      finalUrl: 'https://thelodgeresort.com/golf',
      status: 200,
      html: `
        <a href="https://the-lodge-golf-course.book.teeitup.com/">Book your Tee Time</a>
        <a href="tel:5756822098">575-682-2098</a>
      `,
    },
  };
  const crawl = await crawlBookingSite('https://thelodgeresort.com/', async (url) => pages[url]);
  assert.equal(crawl.best.platform, 'teeitup');
  assert.equal(crawl.best.booking_url, 'https://the-lodge-golf-course.book.teeitup.com/');
  assert.equal(crawl.best.evidence_page, 'https://thelodgeresort.com/golf');
  assert.equal(crawl.facts.phone, '(575) 682-2098');
  assert.equal(crawl.unknowns.some((hit) => /resnexus/.test(hit.booking_url)), false);
});

test('a 404 course page is not a website and its hotel button is not a booking link', async () => {
  const crawl = await crawlBookingSite('https://thelodgeresort.com/golf.cfm', async () => ({
    url: 'https://thelodgeresort.com/golf.cfm',
    finalUrl: 'https://thelodgeresort.com/golf.cfm',
    status: 404,
    html: '<title>The Lodge: 404 Not Found</title><a href="https://resnexus.com/resnexus/reservations/book/ABC">Book Now</a>',
  }));
  assert.equal(pageUnusable(crawl.fetched[0] ? { status: 404, html: '<title>404 Not Found</title>' } : null), true);
  assert.equal(crawl.best, null);
  assert.equal(outcomeFromCrawl(crawl).support, 'fetch_failed');
});

test('Tee It Up facility id is read from the booking page', () => {
  const html = '{\\"alias\\":\\"the-lodge-golf-course\\",\\"gnFacilityIds\\":[12629],\\"name\\":\\"The Lodge\\"}';
  assert.equal(teeItUpFacilityIdFromHtml(html), '12629');
  const enriched = applyVendorEnrichment(
    classifyBookingUrl('https://the-lodge-golf-course.book.teeitup.com/'),
    { facility_id: '12629' },
  );
  assert.equal(enriched.platform, 'teeitup');
  assert.equal(enriched.hints.facility_id, '12629');
  assert.equal(enriched.hints.teeitup_alias, 'the-lodge-golf-course');
  assert.equal(enriched.support, 'live_ready');
});

test('extractCourseFacts reads a single layout and ignores a mixed 9 and 18 page', () => {
  const single = extractCourseFacts(`
    <html><head>
      <meta name="description" content="A public nine hole course along the river with a full driving range and practice green.">
    </head><body>
      <p>Play 9 holes at par 36 and 2,800 yards from the back tee.</p>
      <a href="tel:+18015551234">Call</a>
    </body></html>
  `);
  assert.equal(single.holes, 9);
  assert.equal(single.par, 36);
  assert.equal(single.yardage, 2800);
  assert.equal(single.phone, '(801) 555-1234');
  assert.match(single.editorial_note, /nine hole course along the river/);

  const mixed = extractCourseFacts(`
    <p>Championship 18 holes, par 72, 6,800 yards. A quick 9 holes is also available at par 36 and 3,100 yards.</p>
  `);
  assert.equal(mixed.holes, undefined);
  assert.equal(mixed.par, undefined);
  assert.equal(mixed.yardage, 6800);
});

test('chronogolf widget links resolve to the club page that lists course ids', () => {
  assert.equal(
    chronogolfClubPageUrl('https://www.chronogolf.com/en/club/14711/widget?source=club&medium=widget'),
    'https://www.chronogolf.com/club/14711',
  );
  assert.equal(
    chronogolfClubPageUrl('https://www.chronogolf.com/club/gold-mountain-golf-club/booking'),
    'https://www.chronogolf.com/club/gold-mountain-golf-club',
  );
});
