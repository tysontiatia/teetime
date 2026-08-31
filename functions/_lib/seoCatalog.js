export const SITE = 'https://tee-time.io';

const DEFAULTS = {
  SUPABASE_URL: 'https://nmwlebcvezybfwertlzs.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5td2xlYmN2ZXp5YmZ3ZXJ0bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTUzMjcsImV4cCI6MjA5MTkzMTMyN30.N8Q8T6Mf9_AdzysqgD46tOYMnmB8xTNerU9q7GM7Rlg',
};

/** Crawlable markets — hyperspecific enough for “tee times in X”, not combo-spam. */
export const MARKETS = [
  {
    slug: 'arizona',
    name: 'Arizona',
    kind: 'state',
    state: 'AZ',
    q: 'Arizona',
    blurb:
      'Live public-course tee times across Arizona. Compare open Saturday mornings in Phoenix, Scottsdale, and Tucson, then book on the course site — no markup.',
  },
  {
    slug: 'utah',
    name: 'Utah',
    kind: 'state',
    state: 'UT',
    q: 'Utah',
    blurb:
      'Live tee times at public courses across Utah — Salt Lake County, Park City, St. George, and the Wasatch Front. Search once, book direct.',
  },
  {
    slug: 'idaho',
    name: 'Idaho',
    kind: 'state',
    state: 'ID',
    q: 'Idaho',
    blurb:
      'Live tee times at public courses in Idaho, including Boise and the Treasure Valley. See what’s open and book on the course site.',
  },
  {
    slug: 'salt-lake-city',
    name: 'Salt Lake City',
    kind: 'city',
    state: 'UT',
    q: 'Salt Lake City',
    aliases: [
      'salt lake city',
      'slc',
      'sandy',
      'murray',
      'west jordan',
      'south jordan',
      'west valley',
      'holladay',
      'millcreek',
      'taylorsville',
      'cottonwood',
      'draper',
    ],
    blurb:
      'Live tee times at public courses in and around Salt Lake City. Compare Bonneville, Forest Dale, Meadow Brook, and more — then book on the course site.',
  },
  {
    slug: 'park-city',
    name: 'Park City',
    kind: 'city',
    state: 'UT',
    q: 'Park City',
    aliases: ['park city', 'heber', 'midway'],
    blurb: 'Live tee times near Park City and Heber Valley. See what’s open this weekend and book direct.',
  },
  {
    slug: 'st-george',
    name: 'St. George',
    kind: 'city',
    state: 'UT',
    q: 'St. George',
    aliases: ['st. george', 'st george', 'washington', 'hurricane', 'ivins'],
    blurb: 'Live tee times in St. George and southern Utah. Compare public courses and book on the course site.',
  },
  {
    slug: 'ogden',
    name: 'Ogden',
    kind: 'city',
    state: 'UT',
    q: 'Ogden',
    aliases: ['ogden', 'roy', 'layton', 'kaysville'],
    blurb: 'Live tee times along the northern Wasatch Front — Ogden, Layton, and nearby public courses.',
  },
  {
    slug: 'phoenix',
    name: 'Phoenix',
    kind: 'city',
    state: 'AZ',
    q: 'Phoenix',
    aliases: ['phoenix', 'glendale', 'peoria', 'avondale', 'goodyear', 'litchfield'],
    blurb: 'Live public-course tee times in Phoenix. See open Saturday mornings and book on the course site.',
  },
  {
    slug: 'scottsdale',
    name: 'Scottsdale',
    kind: 'city',
    state: 'AZ',
    q: 'Scottsdale',
    aliases: ['scottsdale', 'paradise valley', 'fountain hills'],
    blurb: 'Live tee times at public courses in Scottsdale. Compare open slots and book direct — no booking fee from us.',
  },
  {
    slug: 'mesa',
    name: 'Mesa',
    kind: 'city',
    state: 'AZ',
    q: 'Mesa',
    aliases: ['mesa', 'gilbert', 'chandler', 'tempe', 'queen creek'],
    blurb: 'Live tee times in Mesa, Gilbert, Chandler, and Tempe. Search East Valley public courses in one place.',
  },
  {
    slug: 'tucson',
    name: 'Tucson',
    kind: 'city',
    state: 'AZ',
    q: 'Tucson',
    aliases: ['tucson', 'oro valley', 'marana', 'green valley'],
    blurb: 'Live tee times at public courses in Tucson and southern Arizona. See what’s open, then book on the course site.',
  },
  {
    slug: 'boise',
    name: 'Boise',
    kind: 'city',
    state: 'ID',
    q: 'Boise',
    aliases: ['boise', 'meridian', 'eagle', 'nampa', 'garden city'],
    blurb: 'Live tee times in Boise and the Treasure Valley. Compare public courses and book direct.',
  },
];

export function marketBySlug(slug) {
  const key = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return MARKETS.find((m) => m.slug === key) || null;
}

export function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function shortName(full) {
  const m = String(full || '').match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  return m ? m[1].trim() : String(full || '').trim();
}

function recState(rec) {
  const addr = String(rec.address || '');
  const m = addr.match(/,\s*([A-Z]{2})(?:\s+\d{5}|\b)/);
  if (m) return m[1];
  const area = String(rec.area || '').toLowerCase();
  if (area.includes('arizona')) return 'AZ';
  if (area.includes('idaho')) return 'ID';
  if (area.includes('wyoming')) return 'WY';
  if (area.includes('utah') || area.includes('salt lake') || area.includes('wasatch')) return 'UT';
  return '';
}

function recCity(rec) {
  const addr = String(rec.address || '');
  const m = addr.match(/,\s*([^,]+?),\s*[A-Z]{2}\b/);
  if (m) return m[1].trim().toLowerCase();
  const name = String(rec.name || '');
  const p = name.match(/\(([^)]+)\)\s*$/);
  return p ? p[1].trim().toLowerCase() : '';
}

export function courseMatchesMarket(rec, market) {
  if (!rec || !market) return false;
  const st = recState(rec);
  if (market.kind === 'state') return st === market.state;
  if (st && st !== market.state) return false;
  const city = recCity(rec);
  if (!city) return false;
  const aliases = market.aliases || [market.name.toLowerCase()];
  return aliases.some((a) => city === a || city.includes(a) || a.includes(city));
}

export async function fetchRegistryCourses(env = {}) {
  const url = env.SUPABASE_URL || DEFAULTS.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || DEFAULTS.SUPABASE_ANON_KEY;
  const res = await fetch(`${url}/rest/v1/course_registry?select=slug,record&order=slug`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => r?.slug && r.record)
    .map((r) => ({ slug: r.slug, record: r.record }));
}

export function coursesForMarket(rows, market) {
  return rows
    .filter((r) => courseMatchesMarket(r.record, market))
    .map((r) => ({
      slug: r.slug,
      name: shortName(r.record.name) || r.slug,
      city: recCity(r.record),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
