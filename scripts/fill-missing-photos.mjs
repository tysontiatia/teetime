#!/usr/bin/env node
import { readFileSync } from 'fs';
import { fillMissingCoursePhotos } from '../worker/coursePhotoEnrich.js';

function loadDevVars() {
  const content = readFileSync(new URL('../worker/.dev.vars', import.meta.url), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = val;
  }
}

loadDevVars();

const result = await fillMissingCoursePhotos({
  GOOGLE_PLACES_KEY: process.env.GOOGLE_PLACES_KEY,
  SUPABASE_URL: process.env.SUPABASE_URL || 'https://nmwlebcvezybfwertlzs.supabase.co',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

console.log(JSON.stringify(result.counts));
if (result.filled.length) {
  console.log(result.filled.join('\n'));
}
