// Generates ZIP centroid maps for the finder's zip search.
// Uses the bundled `zipcodes` dataset (dev dependency) so the runtime app
// ships only the JSON, with no network lookup for a known US zip.
//
// Regenerate with: node scripts/generate-utah-zips.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import zipcodes from 'zipcodes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UTAH_OUT = resolve(__dirname, '../frontend/src/data/utahZipCentroids.json');
const US_OUT = resolve(__dirname, '../frontend/src/data/usZipCentroids.json');

function round4(n) {
  return Number(n.toFixed(4));
}

const utah = {};
const us = {};
for (const [zip, info] of Object.entries(zipcodes.codes)) {
  if (!/^\d{5}$/.test(zip) || !info) continue;
  if (typeof info.latitude !== 'number' || typeof info.longitude !== 'number') continue;
  if (typeof info.state !== 'string' || info.state.length !== 2) continue;
  const lat = round4(info.latitude);
  const lng = round4(info.longitude);
  us[zip] = [lat, lng, info.state];
  if (info.state === 'UT') utah[zip] = [lat, lng];
}

// Guard against another interpolated dataset. These pins are the real cities.
const EXPECTED = {
  '84101': { lat: 40.76, lng: -111.89 },
  '84790': { lat: 37.08, lng: -113.56 },
  '85251': { lat: 33.49, lng: -111.92 },
  '89101': { lat: 36.17, lng: -115.14 },
  '83301': { lat: 42.56, lng: -114.47 },
};
for (const [zip, expect] of Object.entries(EXPECTED)) {
  const got = us[zip];
  if (!got) throw new Error(`Missing centroid for ${zip}`);
  const dLat = Math.abs(got[0] - expect.lat);
  const dLng = Math.abs(got[1] - expect.lng);
  if (dLat > 0.2 || dLng > 0.2) {
    throw new Error(`${zip} landed at ${got[0]},${got[1]}, expected near ${expect.lat},${expect.lng}`);
  }
}

mkdirSync(dirname(US_OUT), { recursive: true });
writeFileSync(UTAH_OUT, JSON.stringify(utah) + '\n');
writeFileSync(US_OUT, JSON.stringify(us));
console.log(`Wrote ${Object.keys(utah).length} Utah ZIPs and ${Object.keys(us).length} US ZIPs`);
