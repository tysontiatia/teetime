import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PHOTO_ATTEMPTS,
  choosePhotoCandidate,
  classifyPlacesHttp,
  classifyPlacesStatus,
  firstPhotoReference,
  photoFailurePatch,
  photoRetryDelayMs,
} from './coursePhotoEnrich.js';

test('the first photo id is kept, legacy reference or new resource name', () => {
  assert.equal(firstPhotoReference([{ photo_reference: 'photo-1' }, { photo_reference: 'photo-2' }]), 'photo-1');
  assert.equal(firstPhotoReference([{ name: 'places/abc/photos/photo-1' }]), 'places/abc/photos/photo-1');
  assert.equal(firstPhotoReference([]), '');
});

test('a dead place id stops for good; key and quota errors stop the batch', () => {
  assert.equal(classifyPlacesStatus('OK'), 'ok');
  assert.equal(classifyPlacesStatus('NOT_FOUND'), 'gone');
  assert.equal(classifyPlacesStatus('INVALID_REQUEST'), 'gone');
  assert.equal(classifyPlacesStatus('OVER_QUERY_LIMIT'), 'stop');
  assert.equal(classifyPlacesStatus('REQUEST_DENIED'), 'stop');
  assert.equal(classifyPlacesStatus('UNKNOWN_ERROR'), 'retry');
  assert.equal(classifyPlacesHttp(429), 'stop');
  assert.equal(classifyPlacesHttp(403), 'stop');
  assert.equal(classifyPlacesHttp(503), 'retry');
});

test('NOT_FOUND stamps the course so the cron never asks again', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  assert.deepEqual(photoFailurePatch(0, 'gone', now), {
    photos_fetched_at: now.toISOString(),
    photo_failed_reason: 'place_not_found',
    photo_next_attempt_at: null,
  });
});

test('a retry backs off and gives up after the last attempt', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  assert.equal(photoRetryDelayMs(1), 30 * 60 * 1000);
  assert.equal(photoRetryDelayMs(3), 2 * 60 * 60 * 1000);
  const first = photoFailurePatch(0, 'retry', now);
  assert.equal(first.photo_attempts, 1);
  assert.equal(first.photo_next_attempt_at, '2026-11-18T12:30:00.000Z');
  assert.equal(first.photos_fetched_at, undefined);
  const last = photoFailurePatch(MAX_PHOTO_ATTEMPTS - 1, 'retry', now);
  assert.equal(last.photo_failed_reason, 'gave_up');
  assert.equal(last.photos_fetched_at, now.toISOString());
});

test('a key or quota stop pauses the course without counting an attempt', () => {
  const now = new Date('2026-11-18T12:00:00Z');
  const patch = photoFailurePatch(2, 'stop', now);
  assert.equal(patch.photo_attempts, undefined);
  assert.equal(patch.photo_next_attempt_at, '2026-11-18T13:00:00.000Z');
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
