import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePhotoCandidate, placeFactsFromDetails } from './coursePhotoEnrich.js';

test('place details keep the rating, review count, and first photo id', () => {
  const facts = placeFactsFromDetails({
    rating: 4.4,
    user_ratings_total: 312,
    photos: [{ photo_reference: 'photo-1' }, { photo_reference: 'photo-2' }],
    formatted_phone_number: '(801) 555-0100',
  });
  assert.deepEqual(facts, {
    rating: 4.4,
    review_count: 312,
    photo_reference: 'photo-1',
    phone: '(801) 555-0100',
  });
});

test('a Places photo resource name is kept as the stored photo id', () => {
  const facts = placeFactsFromDetails({
    photos: [{ name: 'places/abc/photos/photo-1' }],
  });
  assert.equal(facts.photo_reference, 'places/abc/photos/photo-1');
  assert.equal(facts.rating, null);
});

test('the same course name keeps the nearby photo instead of a closer empty pin', () => {
  const chosen = choosePhotoCandidate(
    'Del Monte Golf Course (Monterey)',
    [
      { name: 'Del Monte Golf Course', photo_reference: '', lat: 36.59, lng: -121.88 },
      { name: 'Del Monte Golf Course', photo_reference: 'places/abc/photos/photo-1', lat: 36.6, lng: -121.89 },
      { name: 'Del Monte Bar & Grill', photo_reference: 'places/abc/photos/bar', lat: 36.59, lng: -121.88 },
    ],
    { lat: 36.59, lng: -121.88 },
  );
  assert.equal(chosen.photo_reference, 'places/abc/photos/photo-1');
});

test('a campground that only shares the course name does not supply the photo', () => {
  const chosen = choosePhotoCandidate(
    'Benbow Golf Course (Garberville)',
    [
      { name: 'Benbow KOA Holiday', photo_reference: 'places/abc/photos/koa', lat: 40.1, lng: -123.8 },
      { name: 'Benbow Golf Course', photo_reference: '', lat: 40.1, lng: -123.8 },
    ],
    { lat: 40.1, lng: -123.8 },
  );
  assert.equal(chosen.name, 'Benbow Golf Course');
  assert.equal(chosen.photo_reference, '');
});
