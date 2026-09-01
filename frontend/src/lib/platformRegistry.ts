import type { Course } from '../types';

export type PlatformCapability = 'live_inventory' | 'booking_link_only' | 'auth_gated_planned';

export type PlatformDef = {
  key: string;
  label: string;
  capability: PlatformCapability;
  /** Shown in admin platform pickers. */
  inPicker: boolean;
  aliases?: string[];
  /** Hostname fragments for client-side detect when the worker is behind. */
  hosts?: string[];
};

/**
 * Canonical vendor keys. Live adapters belong here AND in the worker.
 * Link-only keys are the “what to build next” backlog — never free-text.
 */
export const PLATFORM_DEFS: readonly PlatformDef[] = [
  { key: 'foreup', label: 'ForeUp', capability: 'live_inventory', inPicker: true, aliases: ['fore up', 'foreupsoftware'], hosts: ['foreupsoftware.com'] },
  { key: 'foreup_login', label: 'ForeUp (account)', capability: 'auth_gated_planned', inPicker: true },
  { key: 'chronogolf', label: 'Chronogolf', capability: 'live_inventory', inPicker: true, hosts: ['chronogolf.com'] },
  { key: 'chronogolf_slc', label: 'Chronogolf (club login)', capability: 'live_inventory', inPicker: true },
  { key: 'membersports', label: 'MemberSports', capability: 'live_inventory', inPicker: true, aliases: ['member sports'], hosts: ['membersports.com'] },
  { key: 'teeitup', label: 'TeeItUp', capability: 'live_inventory', inPicker: true, aliases: ['tee it up', 'aspira'], hosts: ['teeitup'] },
  { key: 'trutee', label: 'Trutee', capability: 'live_inventory', inPicker: true, aliases: ['tru tee'], hosts: ['trutee.app'] },
  { key: 'golfpay', label: 'GolfPay', capability: 'live_inventory', inPicker: true, aliases: ['golf pay'], hosts: ['golfpay.co'] },
  { key: 'tenfore', label: 'TenFore', capability: 'booking_link_only', inPicker: true, aliases: ['ten fore'], hosts: ['tenfore'] },
  { key: 'cps', label: 'Club Prophet', capability: 'booking_link_only', inPicker: true, aliases: ['club prophet', 'clubprophet', 'cps golf'], hosts: ['cps.golf'] },
  { key: 'golfnow', label: 'GolfNow', capability: 'booking_link_only', inPicker: true, aliases: ['golf now', 'golf-now', 'nbc golfnow'], hosts: ['golfnow'] },
  { key: 'ezlinks', label: 'EZLinks', capability: 'booking_link_only', inPicker: true, aliases: ['ez links', 'ez-links', 'ezlinksgolf'], hosts: ['ezlinksgolf', 'ezlinks.com'] },
  { key: 'teesnap', label: 'TeeSnap', capability: 'booking_link_only', inPicker: true, aliases: ['tee snap'], hosts: ['teesnap'] },
  { key: 'clubessentials', label: 'Club Essentials', capability: 'booking_link_only', inPicker: true, aliases: ['club essential', 'clubessentials'], hosts: ['clubessential'] },
  { key: 'lightspeed', label: 'Lightspeed', capability: 'booking_link_only', inPicker: true, aliases: ['light speed'] },
  { key: 'teeoff', label: 'TeeOff', capability: 'booking_link_only', inPicker: true, aliases: ['tee off', 'pga teeoff'], hosts: ['teeoff.com'] },
  { key: 'golfrev', label: 'GolfRev', capability: 'booking_link_only', inPicker: true, aliases: ['golf rev', 'golf-rev'], hosts: ['golfrev.com'] },
  {
    key: 'sagacity',
    label: 'Sagacity',
    capability: 'booking_link_only',
    inPicker: true,
    aliases: ['sagacity golf', 'sagacitygolf'],
    hosts: ['sagacitygolf.com'],
  },
  { key: 'quick18', label: 'Quick18', capability: 'live_inventory', inPicker: true, aliases: ['quick 18', 'play18', 'play 18', 'play-18'], hosts: ['quick18.com', 'play18.com'] },
  { key: 'golfwithaccess', label: 'GolfWithAccess', capability: 'booking_link_only', inPicker: true, aliases: ['golf with access'], hosts: ['golfwithaccess.com'] },
  { key: 'clubcaddie', label: 'ClubCaddie', capability: 'booking_link_only', inPicker: true, aliases: ['club caddie'], hosts: ['clubcaddie.com'] },
  {
    key: 'rguest',
    label: 'rGuest',
    capability: 'booking_link_only',
    inPicker: true,
    aliases: ['r guest', 'agilysys', 'onagilysys'],
    hosts: ['rguest.com', 'onagilysys.com'],
  },
  { key: 'totaleintegrated', label: 'Totale Integrated', capability: 'booking_link_only', inPicker: true, aliases: ['totale', 'totale integrated'], hosts: ['totaleintegrated.net'] },
  { key: 'clubhouseonline', label: 'ClubHouse Online', capability: 'booking_link_only', inPicker: true, aliases: ['clubhouse online', 'clubhouseonline'], hosts: ['clubhouseonline'] },
  { key: 'golfscape', label: 'Golfscape', capability: 'booking_link_only', inPicker: true, aliases: ['golf scape'], hosts: ['golfscape.com'] },
  { key: 'fareharbor', label: 'FareHarbor', capability: 'booking_link_only', inPicker: true, aliases: ['fare harbor'], hosts: ['fareharbor.com'] },
  { key: 'easyteegolf', label: 'EasyTee Golf', capability: 'booking_link_only', inPicker: true, aliases: ['easy tee', 'easytee'], hosts: ['easyteegolf.com'] },
  { key: 'vscloud', label: 'VS Cloud', capability: 'booking_link_only', inPicker: true, aliases: ['vermont systems', 'myvscloud', 'webtrac'], hosts: ['myvscloud.com'] },
  { key: 'prophetservices', label: 'Prophet Services', capability: 'booking_link_only', inPicker: true, aliases: ['prophet services'], hosts: ['prophetservices.com'] },
  { key: 'valorclubs', label: 'Valor Clubs', capability: 'booking_link_only', inPicker: true, aliases: ['valor clubs'], hosts: ['valorclubs.com'] },
  { key: 'floatinggreen', label: 'Floating Green', capability: 'booking_link_only', inPicker: true, aliases: ['floating green', 'floatinggreensoftware'], hosts: ['floatinggreensoftware.com'] },
  { key: 'other', label: 'Other / unknown', capability: 'booking_link_only', inPicker: true },
];

const LIVE_KEYS = new Set(PLATFORM_DEFS.filter((p) => p.capability === 'live_inventory').map((p) => p.key));
const BY_KEY = new Map(PLATFORM_DEFS.map((p) => [p.key, p]));

function compactKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

const ALIAS_TO_KEY = (() => {
  const m = new Map<string, string>();
  for (const p of PLATFORM_DEFS) {
    m.set(compactKey(p.key), p.key);
    m.set(compactKey(p.label), p.key);
    for (const alias of p.aliases ?? []) m.set(compactKey(alias), p.key);
  }
  return m;
})();

/** Keys shown in admin <select> (canonical only). */
export const ADMIN_PLATFORM_KEYS: string[] = PLATFORM_DEFS.filter((p) => p.inPicker).map((p) => p.key);

/**
 * Map a stored platform key or a free-text vendor note onto a canonical key.
 * Returns '' when we cannot classify it.
 */
export function canonicalizePlatform(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const direct = BY_KEY.get(trimmed);
  if (direct) return direct.key;
  return ALIAS_TO_KEY.get(compactKey(trimmed)) || '';
}

const SKIP_VENDOR_NOTES = new Set(['unknown', 'other', 'n/a', 'na', 'none', 'tbd']);
const SKIP_HOST_LABELS = new Set([
  'www',
  'www2',
  'book',
  'go',
  'app',
  'api',
  'm',
  'secure',
  'booking',
  'reserve',
  'tee',
  'teetimes',
  'com',
  'net',
  'org',
  'io',
  'golf',
  'co',
  'us',
  'uk',
  'info',
  'club',
]);
const GENERIC_BRANDS = new Set([
  'google',
  'facebook',
  'instagram',
  'squarespace',
  'wix',
  'wordpress',
  'godaddy',
  'linktr',
  'bitly',
  'youtube',
  'lovable',
]);

/** Turn a typed vendor name into a stable key (`Play 18` → `quick18`). */
export function vendorKeyFromLabel(raw: string | null | undefined): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed || SKIP_VENDOR_NOTES.has(compactKey(trimmed))) return '';
  const known = canonicalizePlatform(trimmed);
  if (known && known !== 'other') return known;
  const key = compactKey(trimmed);
  return key.length >= 3 ? key : '';
}

/** Classify a booking URL from hostname when the worker has not mapped it yet. */
export function detectPlatformFromBookingUrl(rawUrl: string): string {
  let host = '';
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
  for (const p of PLATFORM_DEFS) {
    if (p.hosts?.some((frag) => host.includes(frag))) return p.key;
  }
  const labels = host
    .replace(/^www\./, '')
    .split('.')
    .filter((p) => p && !SKIP_HOST_LABELS.has(p));
  const brand = labels[labels.length - 1] || '';
  if (brand.length < 3 || GENERIC_BRANDS.has(brand)) return '';
  const known = canonicalizePlatform(brand);
  if (known && known !== 'other') return known;
  return compactKey(brand);
}

/**
 * Roll-up key for backlog counts. Prefers platform, then vendor note (legacy QA free text).
 */
export function platformGroupKey(
  platform: string | null | undefined,
  note?: string | null,
): string {
  const fromPlatform = canonicalizePlatform(platform);
  if (fromPlatform && fromPlatform !== 'other') return fromPlatform;
  if (platform && platform !== 'other' && !workerSupportedPlatform(platform)) {
    const minted = vendorKeyFromLabel(platform);
    if (minted) return minted;
  }
  const fromNote = canonicalizePlatform(note) || vendorKeyFromLabel(note);
  if (fromNote && fromNote !== 'other') return fromNote;
  if (fromPlatform === 'other' || String(note || '').trim()) return 'other';
  return fromPlatform;
}

/** True when `key` is a canonical vendor in PLATFORM_DEFS (not a minted leftover like `club`). */
export function isRegisteredPlatform(key: string | null | undefined): boolean {
  const k = String(key || '').trim();
  return Boolean(k && BY_KEY.has(k));
}

/**
 * Vendor to show in admin. A known host on the booking URL wins over a stored
 * `other` / leftover key so the backlog rollup stays honest before we persist.
 * Never overrides a live adapter from a URL guess.
 */
export function effectivePlatform(course: {
  platform?: string | null;
  booking_status_note?: string | null;
  booking_url?: string | null;
}): string {
  const stored = platformGroupKey(course.platform, course.booking_status_note);
  if (stored && workerSupportedPlatform(stored)) return stored;
  if (course.booking_url) {
    const fromUrl = detectPlatformFromBookingUrl(course.booking_url);
    if (fromUrl && fromUrl !== 'other' && isRegisteredPlatform(fromUrl)) return fromUrl;
  }
  return stored;
}

/**
 * Live inventory: worker proxies the vendor API and we normalize tee rows.
 * Add new platforms in PLATFORM_DEFS and implement the matching route in `worker/index.js`.
 */
export function workerSupportedPlatform(platform: string): boolean {
  return LIVE_KEYS.has(platform);
}

export function filterWorkerCourses(courses: Course[]): Course[] {
  return courses.filter((c) =>
    workerSupportedPlatform(effectivePlatform({ platform: c.platform, booking_url: c.bookingUrl })),
  );
}

export function getPlatformCapability(platform: string | undefined): PlatformCapability {
  if (!platform) return 'booking_link_only';
  const canonical = canonicalizePlatform(platform) || platform;
  return BY_KEY.get(canonical)?.capability ?? 'booking_link_only';
}

export function platformDisplayName(platform: string | undefined): string {
  if (!platform) return 'Other';
  const canonical = canonicalizePlatform(platform) || platform;
  const def = BY_KEY.get(canonical);
  if (def) return def.label;
  return canonical.replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

export const ASPIRA_TEEITUP_ALIAS = 'aspira-management-company';

type TeeItUpSource = { teeitup_alias?: string | null; booking_url?: string | null };

/**
 * TeeItUp tenant alias (x-be-alias). Explicit override wins; otherwise the
 * booking URL's subdomain label (…book-v2.teeitup.golf / …book.teeitup.com),
 * defaulting to Aspira.
 */
export function teeItUpAlias(source: TeeItUpSource | null | undefined): string {
  const explicit = source?.teeitup_alias != null ? String(source.teeitup_alias).trim() : '';
  if (explicit) return explicit;
  const m = String(source?.booking_url || '').match(/^https?:\/\/([^.]+)\.book/i);
  return m ? m[1]! : ASPIRA_TEEITUP_ALIAS;
}

/**
 * Caption clarifying which price tier we display. Only the Aspira / Utah State
 * Parks tenant gates residents behind login (we show the non-resident rate);
 * other TeeItUp tenants publish a plain online rate, so no caption.
 */
export function platformPriceCaption(
  source: (TeeItUpSource & { platform?: string | null }) | null | undefined,
): string | null {
  if (source?.platform !== 'teeitup') return null;
  return teeItUpAlias(source) === ASPIRA_TEEITUP_ALIAS ? 'Non-resident rate' : null;
}

export function capabilityHint(cap: PlatformCapability): string {
  switch (cap) {
    case 'live_inventory':
      return 'Live tee times';
    case 'auth_gated_planned':
      return 'Book on the course site, or call the pro shop';
    default:
      return 'Book on the course site, or call the pro shop';
  }
}

/** Admin <select> keys, plus a leftover stored value so the control doesn’t blank. */
export function adminPlatformSelectOptions(current?: string | null): string[] {
  return livePlatformSelectOptions(current);
}

function uniqueKeys(keys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Live adapters only (ForeUp, Chronogolf, …). */
export function livePlatformSelectOptions(current?: string | null): string[] {
  const keys = PLATFORM_DEFS.filter(
    (p) => p.inPicker && (p.capability === 'live_inventory' || p.key === 'foreup_login'),
  ).map((p) => p.key);
  const cur = String(current || '').trim();
  if (cur && workerSupportedPlatform(cur) && !keys.includes(cur)) keys.push(cur);
  return keys;
}

/**
 * Unsupported / backlog picker: known link-only vendors, plus keys already saved on
 * courses (so Play18 shows up after the first save). Live adapters are omitted.
 */
export function backlogPlatformSelectOptions(
  current?: string | null,
  discovered: string[] = [],
): string[] {
  const known = PLATFORM_DEFS.filter(
    (p) => p.inPicker && p.capability !== 'live_inventory' && p.key !== 'foreup_login' && p.key !== 'other',
  ).map((p) => p.key);
  const extra = discovered.filter((k) => k && k !== 'other' && !workerSupportedPlatform(k) && k !== 'foreup_login');
  const cur = String(current || '').trim();
  const keys = uniqueKeys([...known, ...extra, cur].filter((k) => k && k !== 'other' && !workerSupportedPlatform(k)));
  keys.sort((a, b) => platformDisplayName(a).localeCompare(platformDisplayName(b)));
  keys.push('other');
  return keys;
}

export function discoveredBacklogPlatformKeys(
  courses: Array<{ platform?: string | null; booking_status_note?: string | null; booking_url?: string | null }>,
): string[] {
  const keys = new Set<string>();
  for (const c of courses) {
    const grouped = effectivePlatform(c);
    if (grouped && grouped !== 'other' && !workerSupportedPlatform(grouped)) keys.add(grouped);
    if (c.booking_url) {
      const fromUrl = detectPlatformFromBookingUrl(c.booking_url);
      if (fromUrl && fromUrl !== 'other' && !workerSupportedPlatform(fromUrl) && isRegisteredPlatform(fromUrl)) {
        keys.add(fromUrl);
      }
    }
  }
  return [...keys].sort((a, b) => platformDisplayName(a).localeCompare(platformDisplayName(b)));
}

export type PlatformRollup = {
  key: string;
  label: string;
  count: number;
  live: boolean;
};

type PlatformRollupSource = {
  platform?: string | null;
  booking_status?: string | null;
  booking_status_note?: string | null;
  booking_url?: string | null;
};

/** Counts vendors we can name. Skips pending / phone / private / closed with no platform. */
export function rollupPlatforms(courses: PlatformRollupSource[]): PlatformRollup[] {
  const counts = new Map<string, number>();
  for (const c of courses) {
    const status = String(c.booking_status || '').trim();
    if (status === 'pending' || status === 'phone' || status === 'private' || status === 'closed') continue;
    const key = effectivePlatform(c);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: platformDisplayName(key),
      count,
      live: workerSupportedPlatform(key),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
