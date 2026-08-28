import test from 'node:test';
import assert from 'node:assert/strict';
import {
  citiesCompatible,
  courseNamesLikelyDuplicate,
  inferCourseState,
  locationsCompatibleForImport,
  normalizeCityKey,
} from './courseAdmin.js';

test('normalizeCityKey aliases SLC / Eagle Mtn', () => {
  assert.equal(normalizeCityKey('Salt Lake City'), 'slc');
  assert.equal(normalizeCityKey('Eagle Mountain'), 'eagle mtn');
  assert.ok(citiesCompatible('Salt Lake City', 'SLC'));
  assert.ok(citiesCompatible('Eagle Mountain', 'Eagle Mtn'));
});

test('courseNamesLikelyDuplicate matches shortened catalog names', () => {
  assert.ok(courseNamesLikelyDuplicate('Bonneville Golf Course (Salt Lake City)', 'Bonneville (SLC)'));
  assert.ok(courseNamesLikelyDuplicate('Soldier Hollow Golf Course (Midway)', 'Soldier Hollow Gold (Midway)'));
  assert.ok(courseNamesLikelyDuplicate('Links at Sleepy Ridge (Orem)', 'Sleepy Ridge (Orem)'));
  assert.ok(courseNamesLikelyDuplicate('The Barn Golf Course (Ogden)', 'Barn Golf Club (Ogden)'));
  assert.ok(courseNamesLikelyDuplicate('Green Spring Golf Course (Washington)', 'Green Spring (St. George)'));
  assert.ok(courseNamesLikelyDuplicate('Cedar Hills Golf Club (Cedar Hills)', 'Cedar Hills (Cedar Hills)'));
  assert.ok(courseNamesLikelyDuplicate('Park City Golf Course (Park City)', 'Park City Golf Club (Park City)'));
});

test('courseNamesLikelyDuplicate avoids cross-club false positives', () => {
  assert.equal(courseNamesLikelyDuplicate('Logan Country Club (Logan)', 'Logan River (Logan)'), false);
  assert.equal(courseNamesLikelyDuplicate('Ogden Golf & Country Club (Ogden)', 'Mt. Ogden (Ogden)'), false);
  assert.equal(
    courseNamesLikelyDuplicate('The Ledges of St. George (St. George)', 'St. George Golf Club (St. George)'),
    false,
  );
});

test('locationsCompatibleForImport uses address when cities differ', () => {
  assert.ok(
    locationsCompatibleForImport(
      { name: 'Green Spring Golf Course (Washington)', address: '588 N Green Spring Dr, Washington, UT 84780, USA' },
      { name: 'Green Spring (St. George)', address: '588 North Green Spring Drive, Washington, UT 84780, USA' },
    ),
  );
  assert.equal(
    locationsCompatibleForImport(
      { name: 'Red Ledges Golf Club (Heber City)' },
      { name: 'The Ledges (St. George)', address: '123 Ledges Dr, St. George, UT 84770, USA' },
    ),
    false,
  );
  assert.equal(
    locationsCompatibleForImport(
      { name: 'The Ridge Golf Club (West Valley City)' },
      { name: 'Bountiful Ridge (Bountiful)', address: 'Bountiful, UT, USA' },
    ),
    false,
  );
});

test('inferCourseState prefers address / Idaho area', () => {
  assert.equal(inferCourseState({ address: 'Eagle, ID 83616', timezone: 'America/Boise', area: 'Idaho · Treasure Valley' }), 'ID');
  assert.equal(inferCourseState({ address: 'Salt Lake City, UT 84108', timezone: 'America/Denver', area: 'SALT LAKE CITY AREA' }), 'UT');
  assert.equal(inferCourseState({ address: 'Phoenix, AZ 85018', timezone: 'America/Phoenix', area: 'Arizona · Phoenix' }), 'AZ');
});
