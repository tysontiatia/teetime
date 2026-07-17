// Generates a compact Utah ZIP -> [lat, lng] centroid map for the finder's
// zip-code search. Uses the bundled `zipcodes` dataset (dev dependency) so the
// runtime app ships only the small JSON, with no network or data dependency.
//
// Regenerate with: node scripts/generate-utah-zips.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import zipcodes from 'zipcodes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../frontend/src/data/utahZipCentroids.json');

// Utah ZIP codes live in the 84001–84791 range.
const out = {};
let count = 0;
for (let z = 84001; z <= 84799; z++) {
  const zip = String(z).padStart(5, '0');
  const info = zipcodes.lookup(zip);
  if (!info || info.state !== 'UT') continue;
  if (typeof info.latitude !== 'number' || typeof info.longitude !== 'number') continue;
  out[zip] = [Number(info.latitude.toFixed(4)), Number(info.longitude.toFixed(4))];
  count++;
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`Wrote ${count} Utah ZIP centroids to ${OUT}`);
