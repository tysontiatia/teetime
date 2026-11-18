import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignLayouts,
  cleanCity,
  cleanFee,
  cleanPhone,
  cleanWebsite,
  cleanZip,
  clubIdFromUrl,
  fillBlanks,
  indexRowsForEntry,
  isClosedClub,
  nameStrength,
  nameTokens,
  layoutKind,
  matchClubsToRegistry,
  membershipBucket,
  mergeSourceRows,
  namesMatch,
} from './courseIndex.js';

const ID = 'b891d760-86ac-11e4-8c28-020000005b00';

test('websites: scrape junk, double scheme, no scheme, tracking params, non-URLs', () => {
  assert.equal(
    cleanWebsite('http://www.worldgolf.com/courses/usa/arkansas/clarendon/pines-golf-club.htmlOpera.HTML/Shell/Open/Command').website,
    'http://www.worldgolf.com/courses/usa/arkansas/clarendon/pines-golf-club.html',
  );
  assert.equal(cleanWebsite('http://http://www.valleyclub.org/').website, 'http://www.valleyclub.org/');
  assert.equal(cleanWebsite('bountifulridgegolf.com').website, 'https://bountifulridgegolf.com/');
  assert.equal(cleanWebsite('https://x.com/golf?course=7&utm_source=a&fbclid=b&gclid=c').website, 'https://x.com/golf?course=7');
  assert.deepEqual(cleanWebsite('Waukon Golf and Country Club'), { website: '', kind: 'none', host: '' });
  assert.equal(cleanWebsite('http://72.3.195.65/userfiles/file/Curse Layout.pdf').kind, 'none');
});

test('directory and shared hosts are labelled, including subdomains', () => {
  assert.equal(cleanWebsite('https://www.facebook.com/somecourse').kind, 'directory');
  assert.equal(cleanWebsite('http://courses.golflink.com/x').kind, 'directory');
  assert.equal(cleanWebsite('https://www.clubcorp.com/Clubs/Canyon-Gate').kind, 'shared');
  assert.equal(cleanWebsite('https://thevillages.com/golf').kind, 'shared');
  assert.equal(cleanWebsite('https://riverwoodsgolf.com/').kind, 'own');
});

test('ZIP, phone, fee and city cleaning', () => {
  assert.equal(cleanZip('IA 50595-7425'), '50595');
  assert.equal(cleanZip('84790-'), '84790');
  assert.equal(cleanZip('2134'), '02134');
  assert.equal(cleanZip(null), '');
  assert.equal(cleanPhone(' 1 (303) 794-4502'), '(303) 794-4502');
  assert.equal(cleanPhone('+18015550100'), '(801) 555-0100');
  assert.equal(cleanPhone('555-0100'), '');
  assert.equal(cleanFee('NC'), '');
  assert.equal(cleanFee('30.00 - 39.99 $'), '30.00 - 39.99 $');
  assert.equal(cleanCity('Havana,, IL', ''), 'Havana');
  assert.equal(cleanCity('26460 Alabama Hwy 71, Flat Rock', '26460 Alabama Hwy 71, Flat Rock'), '');
  assert.equal(cleanCity('', '1000 Hummingbird Lane, Castle Rock, CO'), 'Castle Rock');
});

test('membership buckets follow the import decisions', () => {
  for (const m of ['Public', 'Municipal', 'City/Minu', 'city/miui', 'Semi-Private', 'Semi-private']) assert.equal(membershipBucket(m), 'auto', m);
  for (const m of ['Resort', 'Others', '', null]) assert.equal(membershipBucket(m), 'review', String(m));
  for (const m of ['Private', 'Military']) assert.equal(membershipBucket(m), 'drop', m);
});

test('layouts: rotations and short courses are told apart from main courses', () => {
  assert.equal(layoutKind('Sunrise to Sagebrush', 6), 'rotation');
  assert.equal(layoutKind('Lakes/Mountain', 6), 'rotation');
  assert.equal(layoutKind('Par 3', 3), 'short');
  assert.equal(layoutKind('Short Course 6 Hole', 2), 'short');
  assert.equal(layoutKind('Copper(9 holes )', 2), 'short');
  assert.equal(layoutKind('Copper(18 holes )', 2), 'main');
  assert.equal(layoutKind('Lake Course', 2), 'main');
  assert.equal(layoutKind('Anything', 1), 'main');
});

test('null-club rows are replaced from the retry file by id, or by name for broken URLs', () => {
  const state = [
    { club: null, listName: 'Pines', url: `https://18birdies.com/golf-courses/club/${ID}/pines` },
    { club: null, listName: 'Columbine Country Club ', city: 'Par 3 Course', url: 'https://18birdies.com/golf-courses/club/18 Holes' },
    { club: { name: 'Dup' }, url: 'https://18birdies.com/golf-courses/club/11111111-1111-1111-1111-111111111111/dup', courses: [] },
    { club: { name: 'Dup', phone: '1' }, url: 'https://18birdies.com/golf-courses/club/11111111-1111-1111-1111-111111111111/dup', courses: [{}] },
  ];
  const retry = [
    { club: { name: 'Pines' }, listName: 'Pines', url: `https://18birdies.com/golf-courses/club/${ID}/pines`, courses: [{}] },
    {
      club: { name: 'Columbine Country Club | Par 3 Course' },
      listName: 'Columbine Country Club | Par 3 Course',
      url: 'https://18birdies.com/golf-courses/club/22222222-2222-2222-2222-222222222222/columbine',
      courses: [{}],
    },
  ];
  const { rows, replaced, unresolved } = mergeSourceRows(state, retry);
  assert.equal(replaced, 2);
  assert.equal(unresolved, 0);
  assert.equal(rows.length, 3);
  assert.equal(rows.find((r) => r.club.name === 'Dup').courses.length, 1, 'the fuller duplicate wins');
  assert.equal(clubIdFromUrl(rows[0].url), ID);
});

test('index rows keep factual data only and key by club + course', () => {
  const rows = indexRowsForEntry({
    url: `https://18birdies.com/golf-courses/club/${ID}/x`,
    city: 'Midway, UT',
    club: {
      name: 'Wasatch Mountain State Park Golf Course', addr1: '975 W Golf Course Dr', state: 'UT', post: '84049-1234',
      phone: ' 1 (435) 654-0532', web: 'http://www.wasatchgolf.com/?utm_source=x', email: 'staff@example.com',
      membership: 'Municipal', lat: 40.53, lng: -111.5, fee: 'NC', summ: { overallRating: 4 },
    },
    text: { rating: '4.5', reviews: '200' },
    courses: [
      { name: 'Lake Course', holeCount: 18, ydsTee: 'Blue', tees: [['Blue', 'M', 6942, 72.1, 128]], holes: Array.from({ length: 18 }, () => [4, 1, 400]) },
      { name: 'Mountain Course', holeCount: 18, tees: [], holes: [] },
    ],
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].course_key, `${ID}:lake-course`);
  assert.equal(rows[0].address, '975 W Golf Course Dr, Midway, UT 84049');
  assert.equal(rows[0].phone, '(435) 654-0532');
  assert.equal(rows[0].website, 'http://www.wasatchgolf.com/');
  assert.equal(rows[0].bookable, 'auto');
  assert.equal(rows[0].par, 72);
  assert.equal(rows[0].yardage, 6942);
  assert.deepEqual(rows[0].tees, [{ name: 'Blue', gender: 'M', yards: 6942, rating: 72.1, slope: 128 }]);
  const text = JSON.stringify(rows);
  for (const banned of ['staff@example.com', 'overallRating', 'reviews', '"email"']) assert.equal(text.includes(banned), false, banned);
});

const club = (over) => ({ club_id: over.id, club_name: over.name, zip: over.zip, lat: over.lat, lng: over.lng, rows: over.rows });
const row = (over) => ({ club_name: over.club, course_name: over.course, course_key: `${over.id}:${over.course}`, layout_kind: over.kind || 'main', holes: 18, course_position: over.pos || 0, address: over.address || '' });

test('matching: name + ZIP, name within 1 km, then review; one club can hold several tee sheets', () => {
  const clubs = [
    club({ id: 'w', name: 'Wasatch Mountain State Park Golf Course', zip: '84049', lat: 40.53, lng: -111.5, rows: [row({ id: 'w', club: 'Wasatch Mountain State Park Golf Course', course: 'Lake Course' }), row({ id: 'w', club: 'Wasatch Mountain State Park Golf Course', course: 'Mountain Course', pos: 1 })] }),
    club({ id: 's', name: 'Stonebridge Golf Club At Lake Park', zip: '', lat: 40.70, lng: -111.99, rows: [row({ id: 's', club: 'Stonebridge Golf Club At Lake Park', course: 'Sunrise to Sagebrush', kind: 'rotation' })] }),
    club({ id: 'h', name: 'Hobble Creek Golf Course', zip: '', lat: 40.162, lng: -111.508, rows: [row({ id: 'h', club: 'Hobble Creek Golf Course', course: 'Hobble Creek' })] }),
  ];
  const registry = [
    { slug: 'wasatch-lake-midway', record: { name: 'Wasatch Lake (Midway)', address: '975 W Golf Course Dr, Midway, UT 84049' } },
    { slug: 'wasatch-mountain-midway', record: { name: 'Wasatch Mountain (Midway)', address: 'Midway, UT 84049' } },
    { slug: 'stonebridge-west-valley-city', record: { name: 'Stonebridge (West Valley City)', lat: 40.7005, lng: -111.9905 } },
    { slug: 'hobble-creek-springville', record: { name: 'Hobble Creek (Springville)', lat: 40.11, lng: -111.55 } },
    { slug: 'other', record: { name: 'Somewhere Else (Ogden)', lat: 41.2, lng: -111.9 } },
  ];
  const { links, reviews, unmatchedRegistry } = matchClubsToRegistry(clubs, registry);
  assert.deepEqual(links.get('w').map((l) => [l.slug, l.method]).sort(), [['wasatch-lake-midway', 'name_zip'], ['wasatch-mountain-midway', 'name_zip']]);
  assert.deepEqual(links.get('s'), [{ slug: 'stonebridge-west-valley-city', method: 'name_near' }]);
  assert.equal(links.has('h'), false, 'Hobble Creek is 5.8 km off, so it goes to review');
  assert.equal(reviews.find((r) => r.slug === 'hobble-creek-springville').club_id, 'h');
  assert.deepEqual(unmatchedRegistry, ['other']);

  const bySlug = new Map(registry.map((r) => [r.slug, r]));
  const lakeKey = 'w:Lake Course';
  const assigned = assignLayouts(clubs[0].rows, links.get('w'), bySlug);
  assert.equal(assigned.get(lakeKey), 'wasatch-lake-midway');
  assert.equal(assigned.get('w:Mountain Course'), 'wasatch-mountain-midway');
});

test('a stored 18Birdies club id wins over names', () => {
  const clubs = [club({ id: 'abc', name: 'Totally New Name', zip: '', lat: 0, lng: 0, rows: [row({ id: 'abc', club: 'Totally New Name', course: 'x' })] })];
  const registry = [{ slug: 'old', record: { name: 'Old Name (Town)', birdies_club_id: 'abc' } }];
  assert.deepEqual(matchClubsToRegistry(clubs, registry).links.get('abc'), [{ slug: 'old', method: 'club_id' }]);
});

test('names: city in parentheses and run-together names still match', () => {
  assert.equal(namesMatch('Talons Cove (Saratoga Springs)', 'TalonsCove Golf Club'), true);
  assert.equal(namesMatch('Mountain Dell (SLC)', 'Mountain Dell Golf Courses'), true);
  assert.equal(namesMatch('Glendale (SLC)', 'Rose Park Golf Course'), false);
});

test('fill blanks never overwrites, and course facts need a course link', () => {
  const index = { phone: '(801) 555-0100', website: 'https://a.com/', website_kind: 'own', holes: 18, par: 72, yardage: 6900, tees: [{ name: 'Blue', yards: 6900 }] };
  assert.deepEqual(fillBlanks({ phone_number: '(801) 111-1111', holes: 9 }, index, { courseLinked: true }), {
    website: 'https://a.com/', par: 72, yardage: 6900, tees: index.tees,
  });
  assert.deepEqual(fillBlanks({}, index, { courseLinked: false }), { phone_number: '(801) 555-0100', website: 'https://a.com/' });
  assert.deepEqual(fillBlanks({}, { ...index, website_kind: 'directory' }, { courseLinked: false }), { phone_number: '(801) 555-0100' });
});

test('layouts: one registry entry for a two-course club gets no course link', () => {
  const rows = [
    row({ id: 'd', club: 'Mountain Dell Golf Courses', course: 'Canyon Course' }),
    row({ id: 'd', club: 'Mountain Dell Golf Courses', course: 'Lake Course', pos: 1 }),
  ];
  const bySlug = new Map([['mountain-dell-slc', { slug: 'mountain-dell-slc', record: { name: 'Mountain Dell (SLC)' } }]]);
  assert.equal(assignLayouts(rows, [{ slug: 'mountain-dell-slc' }], bySlug).size, 0);
});

test('layouts: a club whose only main course sits among rotations takes the main course', () => {
  const rows = [
    row({ id: 'p', club: 'Fore Lakes Golf Course', course: 'Fore Lakes (18 Hole Course)' }),
    row({ id: 'p', club: 'Fore Lakes Golf Course', course: 'Par 3', kind: 'short', pos: 1 }),
  ];
  const bySlug = new Map([['fore-lakes', { slug: 'fore-lakes', record: { name: 'Fore Lakes (Taylorsville)' } }]]);
  const out = assignLayouts(rows, [{ slug: 'fore-lakes' }], bySlug);
  assert.deepEqual([...out], [['p:Fore Lakes (18 Hole Course)', 'fore-lakes']]);
});


test('names keep inner parentheses, expand abbreviations, and fold apostrophes', () => {
  assert.deepEqual(nameTokens("Mulligan's Golf (Creekside) (Ogden)", { registry: true }), ['mulligans', 'creekside']);
  assert.deepEqual(nameTokens('Promontory - The Hills (par 3) (Park City)', { registry: true }), ['promontory', 'hills', 'par', '3']);
  assert.deepEqual(nameTokens('Mt. Ogden (Ogden)', { registry: true }), ['mount', 'ogden']);
  assert.deepEqual(nameTokens('Timpanogos Golf Club (The Pasture)'), ['timpanogos', 'pasture']);
});

test('one short shared word is weak; it never links on ZIP alone', () => {
  assert.equal(nameStrength(['ogden'], ['mount', 'ogden']), 'weak');
  assert.equal(nameStrength(['mount', 'ogden'], ['mount', 'ogden']), 'strong');
  assert.equal(nameStrength(['talonscove'], ['talons', 'cove']), 'strong');
  const clubs = [club({ id: 'mo', name: 'Mount Ogden Golf Course', zip: '84403', lat: 41.19, lng: -111.94, rows: [row({ id: 'mo', club: 'Mount Ogden Golf Course', course: 'Mount Ogden' })] })];
  const registry = [
    { slug: 'ogden-golf-country-club-ogden', record: { name: 'Ogden Golf & Country Club (Ogden)', address: '4197 Washington Blvd, Ogden, UT 84403', lat: 41.17, lng: -111.95 } },
    { slug: 'mt-ogden-ogden', record: { name: 'Mt. Ogden (Ogden)', address: '1787 Constitution Way, Ogden, UT 84403' } },
  ];
  const { links } = matchClubsToRegistry(clubs, registry);
  assert.deepEqual(links.get('mo'), [{ slug: 'mt-ogden-ogden', method: 'name_zip' }]);
});

test('a separate par-3 listing loses to the full club and goes to review, not new', () => {
  const clubs = [
    club({ id: 'rl', name: 'Red Ledges - 18 Hole Course', zip: '84032', lat: 40.5, lng: -111.4, rows: [row({ id: 'rl', club: 'Red Ledges - 18 Hole Course', course: 'Red Ledges' })] }),
    club({ id: 'rp', name: 'Red Ledges - Par 3 Course', zip: '84032', lat: 40.5, lng: -111.4, rows: [row({ id: 'rp', club: 'Red Ledges - Par 3 Course', course: '12 Hole Course' })] }),
  ];
  const registry = [{ slug: 'red-ledges-golf-club-heber-city', record: { name: 'Red Ledges Golf Club (Heber City)', address: 'Heber City, UT 84032' } }];
  const { links, reviews } = matchClubsToRegistry(clubs, registry);
  assert.deepEqual(links.get('rl'), [{ slug: 'red-ledges-golf-club-heber-city', method: 'name_zip' }]);
  assert.equal(links.has('rp'), false);
  assert.match(reviews.find((r) => r.club_id === 'rp').reason, /linked to Red Ledges - 18 Hole Course/);
});

test('Sand Hollow layouts in parentheses and par-3 layouts only take matching names', () => {
  const sand = [
    row({ id: 'sh', club: 'Sand Hollow Resort Golf', course: 'Sand Hollow (Champ)' }),
    row({ id: 'sh', club: 'Sand Hollow Resort Golf', course: 'Sand Hollow (Links)', pos: 1 }),
  ];
  const sandReg = new Map([
    ['sand-hollow-championship-hurricane', { record: { name: 'Sand Hollow Championship (Hurricane)' } }],
    ['sand-hollow-links-hurricane', { record: { name: 'Sand Hollow Links (Hurricane)' } }],
  ]);
  const out = assignLayouts(sand, [{ slug: 'sand-hollow-championship-hurricane' }, { slug: 'sand-hollow-links-hurricane' }], sandReg);
  assert.equal(out.get('sh:Sand Hollow (Champ)'), 'sand-hollow-championship-hurricane');
  assert.equal(out.get('sh:Sand Hollow (Links)'), 'sand-hollow-links-hurricane');

  const promo = [
    row({ id: 'p', club: 'Promontory Club', course: 'Pete Dye Canyon Course' }),
    row({ id: 'p', club: 'Promontory Club', course: 'Jack Nicklaus(Painted Valley)', pos: 1 }),
    row({ id: 'p', club: 'Promontory Club', course: 'The Hills(PAR 3)', kind: 'short', pos: 2 }),
  ];
  const promoReg = new Map([
    ['dye', { record: { name: 'Promontory - Pete Dye Course (Park City)' } }],
    ['nicklaus', { record: { name: 'Promontory - Painted Valley (Nicklaus) (Park City)' } }],
    ['hills', { record: { name: 'Promontory - The Hills (par 3) (Park City)' } }],
  ]);
  const p = assignLayouts(promo, [{ slug: 'dye' }, { slug: 'nicklaus' }, { slug: 'hills' }], promoReg);
  assert.equal(p.get('p:Jack Nicklaus(Painted Valley)'), 'nicklaus');
  assert.equal(p.get('p:The Hills(PAR 3)'), 'hills');
  assert.equal(p.get('p:Pete Dye Canyon Course'), 'dye', 'every word of "Pete Dye Course" is in the layout name');
});

test('a club whose own name says it closed is recognised', () => {
  assert.equal(isClosedClub({ club_name: '(Permanently closed) Frank Skull Golf Course' }), true);
  assert.equal(isClosedClub({ club_name: 'Closed Loop Golf' }), true);
  assert.equal(isClosedClub({ club_name: 'Enclosed Valley Golf' }), false);
});

test('a registry name that names a par-3 layout outright takes it', () => {
  const rows = [
    row({ id: 't', club: 'Timpanogos Golf Club', course: 'Championship' }),
    row({ id: 't', club: 'Timpanogos Golf Club', course: 'The Pasture  Par3 Course', kind: 'short', pos: 1 }),
  ];
  const reg = new Map([
    ['champ', { record: { name: 'Timpanogos Championship (Provo)' } }],
    ['pasture', { record: { name: 'Timpanogos Pasture (Provo)' } }],
  ]);
  const out = assignLayouts(rows, [{ slug: 'champ' }, { slug: 'pasture' }], reg);
  assert.equal(out.get('t:Championship'), 'champ');
  assert.equal(out.get('t:The Pasture  Par3 Course'), 'pasture');
});
