import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundsForOverpass,
  matchAddressToCatalog,
  matchPlaceToCatalog,
  matchWebsiteToCatalog,
  tileSearchBox,
} from './stateDiscovery.js';

const centralValley = {
  osm_name: 'Central Valley Golf Course',
  name: 'Central Valley Golf Course (South Salt Lake)',
  lat: 40.7024544,
  lng: -111.9112777,
  address: '800 West Central Valley Road, South Salt Lake, UT, 84119',
};

const catalog = [
  {
    name: 'Round Valley Golf Course (Morgan)',
    lat: 41.042614,
    lng: -111.6314457,
    address: 'Morgan, UT 84050',
    website: 'https://golfroundvalley.com/',
  },
  {
    name: 'Golf The Round (South Salt Lake)',
    lat: 40.7009135,
    lng: -111.9080707,
    address: 'South Salt Lake, UT 84119',
    website: 'https://www.golftheround.com/',
  },
];

test('a renamed course at the same pin matches the catalog name', () => {
  const match = matchPlaceToCatalog(
    {
      name: 'Golf The Round',
      lat: 40.7009135,
      lng: -111.9080707,
      formatted_address: 'South Salt Lake, UT 84119',
    },
    centralValley,
    catalog,
  );
  assert.equal(match?.name, 'Golf The Round (South Salt Lake)');
});

test('the same short token does not attach a course in another city', () => {
  const match = matchPlaceToCatalog(
    {
      name: 'Golf The Round',
      lat: 40.7009135,
      lng: -111.9080707,
      formatted_address: 'South Salt Lake, UT 84119',
    },
    centralValley,
    [catalog[0]],
  );
  assert.equal(match, null);
});

test('the same street address matches across abbreviation and a distant pin', () => {
  const oaks = matchAddressToCatalog(
    '2300 East Powerhouse Road, Spanish Fork, UT, 84660',
    [
      {
        name: 'The Oaks at Spanish Fork (Spanish Fork)',
        address: '2300 E Powerhouse Rd, Spanish Fork, UT 84660, USA',
        lat: 40.1091,
        lng: -111.6726,
      },
    ],
    { lat: 40.0832, lng: -111.6014 },
  );
  assert.equal(oaks?.name, 'The Oaks at Spanish Fork (Spanish Fork)');

  const ridge = matchAddressToCatalog(
    '2430 Bountiful Blvd, Bountiful, UT 84010, USA',
    [
      {
        name: 'Bountiful Ridge (Bountiful)',
        address: '2430 Bountiful Blvd, Bountiful, UT 84010, USA',
        lat: 40.8392982,
        lng: -111.8813666,
      },
    ],
    { lat: 40.8643323, lng: -111.8543183 },
  );
  assert.equal(ridge?.name, 'Bountiful Ridge (Bountiful)');
});

test('the same house number on a different street does not match', () => {
  const match = matchAddressToCatalog(
    '2430 State St, Orem, UT 84057',
    [{ name: 'Bountiful Ridge (Bountiful)', address: '2430 Bountiful Blvd, Bountiful, UT 84010, USA' }],
    { lat: 40.86, lng: -111.85 },
  );
  assert.equal(match, null);
});

test('a current website near the pin matches the catalog course', () => {
  const match = matchWebsiteToCatalog('https://www.golftheround.com/', centralValley, catalog);
  assert.equal(match?.name, 'Golf The Round (South Salt Lake)');
});

test('a large state is split into tiles Overpass can answer', () => {
  const tiles = tileSearchBox({ south: 32.53, west: -124.48, north: 42.01, east: -114.13 });
  assert.equal(tiles.length, 4);
  for (const tile of tiles) {
    assert.ok(tile.north - tile.south <= 5.5);
    assert.ok(tile.east - tile.west <= 5.5);
  }
  assert.equal(Math.min(...tiles.map((tile) => tile.south)), 32.53);
  assert.equal(Math.max(...tiles.map((tile) => tile.north)), 42.01);
  assert.equal(Math.min(...tiles.map((tile) => tile.west)), -124.48);
  assert.equal(Math.max(...tiles.map((tile) => tile.east)), -114.13);
});

test('a small state stays one map search', () => {
  const tiles = tileSearchBox({ south: 37, west: -114.05, north: 42, east: -109.04 });
  assert.equal(tiles.length, 1);
});

test('a date-line state uses its own box instead of the whole world', () => {
  const alaska = boundsForOverpass(51.0, -180, 71.6, 180, [51.2, -179.15, 71.4, -129.98]);
  assert.equal(alaska.west, -179.15);
  assert.equal(alaska.east, -129.98);
  const utah = boundsForOverpass(37, -114.05, 42, -109.04, null);
  assert.ok(utah.west > -180 && utah.east < 180);
  assert.ok(utah.west < -114 && utah.east > -109);
});
