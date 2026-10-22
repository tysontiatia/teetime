import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCourseValidity } from './courseValidity.js';

function kind(choice, confidence = 0.9) {
  return { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } };
}

test('a supported booking platform is added even when the description is uncertain', () => {
  const decision = decideCourseValidity(
    {
      kind: kind('public_course', 0.4),
      same_place: { noul: 0.55 },
      own_website: { noul: 0.5 },
      about_supported: { noul: 0.4 },
      own_tee_sheet: { noul: 0.5 },
    },
    {
      google_place_id: 'place-1',
      website: 'https://chenabend.example/',
      booking_url: 'https://chenabend.example/tee-times',
      platform: 'teeitup',
      support: 'live_ready',
    },
  );
  assert.equal(decision.action, 'import');
  assert.equal(decision.booking_status, 'ready');
});

test('an unsupported booking link is added as a public link', () => {
  const decision = decideCourseValidity(
    { kind: kind('public_course', 0.42), own_tee_sheet: { noul: 0.45 } },
    {
      google_place_id: 'place-1',
      website: 'https://blackdiamond.example/',
      booking_url: 'https://fareharbor.com/embeds/book/blackdiamond/',
      platform: 'fareharbor',
      support: 'link_only',
    },
  );
  assert.equal(decision.action, 'import');
  assert.equal(decision.booking_status, 'unsupported');
});

test('a course with no booking link is added as phone', () => {
  const decision = decideCourseValidity(
    { kind: kind('public_course'), layout_supported: { noul: 0.05 } },
    {
      google_place_id: 'place-1',
      website: 'https://homergolf.example/',
      phone_number: '(907) 555-0100',
      holes: 9,
      support: 'none',
    },
  );
  assert.equal(decision.action, 'import');
  assert.equal(decision.booking_status, 'phone');
  assert.deepEqual(decision.drops, ['layout_supported']);
});

test('an unsupported booking link is kept so the platform can be counted later', () => {
  const decision = decideCourseValidity(
    { kind: kind('public_course') },
    {
      google_place_id: 'place-1',
      phone_number: '(907) 555-0100',
      booking_url: 'https://tournaments-104128.square.site/book',
      platform: 'square.site',
      support: 'link_only',
    },
  );
  assert.equal(decision.action, 'import');
  assert.equal(decision.keepBooking, true);
  assert.equal(decision.booking_status, 'unsupported');
});

test('a simulator is skipped', () => {
  const decision = decideCourseValidity(
    { kind: kind('not_a_course', 0.88) },
    { google_place_id: 'place-2', website: 'https://topgolf.example/', booking_url: 'https://topgolf.example/book' },
  );
  assert.equal(decision.action, 'skip');
});

test('a course with no way to book and no site is held', () => {
  const decision = decideCourseValidity({ kind: kind('public_course', 0.3) }, { osm_name: 'Valley of the Eagles' });
  assert.equal(decision.action, 'review');
});
