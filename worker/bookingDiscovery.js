/**
 * Find a course's online booking URL and name the vendor.
 * Vendor names come from parseBookingUrl. This module only decides which link
 * to trust and whether that vendor can already be polled.
 */

import { parseBookingUrl, slugFromCourseName } from './courseAdmin.js';

const LIVE_ADAPTERS = new Set([
  'foreup',
  'foreup_login',
  'chronogolf',
  'chronogolf_slc',
  'membersports',
  'teeitup',
  'trutee',
  'golfpay',
  'quick18',
  'golfwithaccess',
  'clubcaddie',
  'teesnap',
  'golfrev',
]);

/** Ids the worker needs before live tee times will return. */
const REQUIRED_HINTS = {
  foreup: ['schedule_id'],
  foreup_login: ['schedule_id'],
  chronogolf: ['course_ids'],
  chronogolf_slc: ['club_id', 'course_id', 'affiliation_type_id'],
  membersports: ['golf_club_id', 'golf_course_id'],
  teeitup: ['facility_id'],
  trutee: ['trutee_course_id'],
  golfpay: ['golfpay_course_id'],
  quick18: ['quick18_tenant'],
  golfwithaccess: ['golfwithaccess_slug'],
  clubcaddie: ['clubcaddie_apikey'],
  teesnap: ['teesnap_tenant'],
  golfrev: ['golfrev_course_id', 'golfrev_htc'],
};

const HINT_FIELDS = new Set([
  'schedule_id',
  'booking_class_id',
  'club_id',
  'course_id',
  'affiliation_type_id',
  'golf_club_id',
  'golf_course_id',
  'course_ids',
  'trutee_org_slug',
  'trutee_course_id',
  'golfpay_course_id',
  'cps_tenant',
  'cps_course_id',
  'facility_id',
  'teeitup_course_id',
  'teeitup_alias',
  'quick18_tenant',
  'quick18_course_id',
  'golfwithaccess_course_id',
  'golfwithaccess_slug',
  'clubcaddie_course_id',
  'clubcaddie_apikey',
  'teesnap_tenant',
  'teesnap_course_id',
  'golfrev_course_id',
  'golfrev_htc',
]);

const AGGREGATORS = new Set(['golfnow', 'teeoff', 'golfscape']);

const SKIP_HOSTS = [
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'youtu.be',
  'yelp.com',
  'tripadvisor.com',
  'linkedin.com',
  'tiktok.com',
  'pinterest.com',
  'google.com',
  'goo.gl',
  'maps.apple.com',
  'apple.com',
];

const BOOKING_TEXT =
  /\b(?:tee\s*-?\s*times?|book(?:ing)?(?:\s+a)?\s+tee\s*-?\s*time|book\s+now|book\s+online|online\s+booking|make\s+a\s+tee\s+time)\b/i;
const BOOKING_PATH = /\/(?:book(?:ing)?|tee-?times?|e-?tee-?times?)(?:\/|$)/i;

const PLATFORM_ALIASES = [
  ['chronogolf', 'chronogolf_slc'],
  ['foreup', 'foreup_login'],
];

function hintPresent(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value != null && String(value).trim() !== '';
}

export function missingHints(platform, hints) {
  const keys = REQUIRED_HINTS[platform] || [];
  return keys.filter((key) => !hintPresent(hints?.[key]));
}

export function supportFor(platform, hints) {
  if (!platform) return 'unknown_vendor';
  if (!LIVE_ADAPTERS.has(platform)) return 'link_only';
  if (missingHints(platform, hints).length) return 'live_missing_ids';
  return 'live_ready';
}

export function platformsCompatible(found, expected) {
  const a = String(found || '').trim();
  const b = String(expected || '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return PLATFORM_ALIASES.some((group) => group.includes(a) && group.includes(b));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Groups an unrecognized booking site, so square.site counts as one future platform. */
export function bookingHostKey(url) {
  const parts = hostOf(url).split('.').filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  return parts.slice(-2).join('.');
}

function skippedHost(url) {
  const host = hostOf(url);
  return SKIP_HOSTS.some((skip) => host === skip || host.endsWith(`.${skip}`));
}

function sameSite(a, b) {
  const ha = hostOf(a);
  const hb = hostOf(b);
  if (!ha || !hb) return false;
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

function isPageUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return !/\.(pdf|jpe?g|png|gif|webp|svg|css|js|ico|zip|mp4|woff2?)$/i.test(path);
  } catch {
    return false;
  }
}

function genericVendorAsset(url, classified) {
  const platform = classified?.platform;
  const hints = classified?.hints || {};
  if ((platform === 'chronogolf' || platform === 'chronogolf_slc') && !hintPresent(hints.club_id) && !hintPresent(hints.course_id)) {
    return true;
  }
  const host = hostOf(url);
  if (/^(?:cdn|widgets?|static|assets)\d*\./.test(host)) return true;
  try {
    if (/\/widgets?\//i.test(new URL(url).pathname)) return true;
  } catch {
    return false;
  }
  return false;
}

/** Club id often lives in a Chronogolf widget config, not in an href. */
export function extractEmbeddedVendors(html, pageUrl) {
  const hits = [];
  const chrono = String(html || '').match(/chronogolfSettings\s*=\s*\{[\s\S]{0,500}?clubId["']?\s*[:=]\s*["']?(\d+)/i);
  if (chrono) {
    const bookingUrl = `https://www.chronogolf.com/club/${chrono[1]}`;
    const classified = classifyBookingUrl(bookingUrl);
    classified.hints.club_id = chrono[1];
    hits.push({
      ...classified,
      support: supportFor(classified.platform, classified.hints),
      via: 'embed',
      evidence_page: pageUrl,
    });
  }
  return hits;
}

function courseSpecific(url, hints) {
  if (hints && Object.values(hints).some(hintPresent)) return true;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const path = u.pathname.replace(/\/+$/, '');
  if (path && !/^\/(?:index|home|default)(?:\.html?|\.php)?$/i.test(path)) return true;
  const host = u.hostname.toLowerCase();
  if (/^[a-z0-9-]+\.(?:quick18|play18)\.com$/.test(host)) return true;
  if (/^[a-z0-9-]+\.teesnap\.net$/.test(host)) return true;
  if (/^[a-z0-9-]+\.cps\.golf$/.test(host)) return true;
  if (/^[a-z0-9-]+\.book(?:-v2)?\.teeitup\.(?:golf|com)$/.test(host)) return true;
  return false;
}

function absoluteUrl(raw, base) {
  const trimmed = String(raw || '').trim();
  if (!trimmed || /^(?:mailto:|tel:|javascript:|#)/i.test(trimmed)) return null;
  try {
    const u = new URL(trimmed, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

function attr(tag, name) {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(re);
  if (!match) return '';
  return (match[1] || match[2] || match[3] || '').replace(/&amp;/g, '&').trim();
}

function visibleText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function supplementHints(url, platform, hints) {
  const out = { ...hints };
  let u;
  try {
    u = new URL(url);
  } catch {
    return out;
  }
  if (platform === 'membersports') {
    const match = u.pathname.match(/\/tee-times\/(\d+)\/(\d+)/i);
    if (match) {
      out.golf_club_id = match[1];
      out.golf_course_id = match[2];
    }
  }
  return out;
}

export function classifyBookingUrl(rawUrl) {
  const parsed = parseBookingUrl(rawUrl);
  const bookingUrl = parsed.booking_url || String(rawUrl || '').trim();
  const hints = supplementHints(bookingUrl, parsed.platform, parsed.hints || {});
  return {
    booking_url: bookingUrl,
    platform: parsed.platform || null,
    hints,
    support: parsed.platform ? supportFor(parsed.platform, hints) : null,
  };
}

function scoreHit(hit) {
  let score = 0;
  if (hit.support === 'live_ready') score += 100;
  else if (hit.support === 'live_missing_ids') score += 80;
  else if (hit.support === 'link_only') score += 50;
  else if (hit.support === 'unknown_vendor') score += 20;
  score += Math.min(20, Object.values(hit.hints || {}).filter(hintPresent).length * 5);
  if (AGGREGATORS.has(hit.platform)) score -= 15;
  return score;
}

const LODGING_HOSTS = ['resnexus.com', 'reservationdesk.com', 'cloudbeds.com', 'synxis.com'];

function bookingIntent(text, url) {
  if (BOOKING_TEXT.test(String(text || ''))) return true;
  try {
    return BOOKING_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Room-reservation buttons on a resort site are not the golf tee sheet. */
export function isLodgingBooking(url, text) {
  const host = hostOf(url);
  if (LODGING_HOSTS.some((skip) => host === skip || host.endsWith(`.${skip}`))) return true;
  return /\b(?:book your stay|book a room|hotel reservation|room reservation)\b/i.test(String(text || ''));
}

function golfSection(text, url) {
  const label = String(text || '').replace(/\s+/g, ' ').trim();
  if (/^(?:golf|the golf course|our course|play golf)$/i.test(label)) return true;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    return /^\/(?:golf|golf-course|the-course)(?:\/|$)/i.test(path) && label.length > 0 && label.length < 40;
  } catch {
    return false;
  }
}

/** A dead or not-found page must not count as the course website. */
export function pageUnusable(page) {
  if (page?.error) return true;
  const status = Number(page?.status) || 0;
  if (status >= 400) return true;
  const title = String(page?.html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return /\b404\b|not found/i.test(title.replace(/<[^>]+>/g, ' '));
}

/** Tee It Up puts the poller facility id in the booking page, not the link. */
export function teeItUpFacilityIdFromHtml(html) {
  const text = String(html || '');
  const match =
    text.match(/gnFacilityIds\\?"\s*:\s*\[\s*(\d+)/) ||
    text.match(/facilityIds\\?"\s*:\s*\[\s*"?(\d+)/);
  return match?.[1] || '';
}

/**
 * Read one HTML page. Returns vendor hits, same-site pages worth opening next,
 * and off-site booking links whose host we do not recognize.
 */
export function inspectHtml(html, pageUrl) {
  const flat = String(html || '').replace(/\\\//g, '/');
  const hits = [];
  const followups = [];
  const unknowns = [];
  const seenHits = new Set();
  const seenFollow = new Set();
  const seenUnknown = new Set();

  function consider(raw, via, text) {
    const url = absoluteUrl(String(raw || '').replace(/[),.;\]]+$/g, ''), pageUrl);
    if (!url || skippedHost(url) || !isPageUrl(url)) return;
    const classified = classifyBookingUrl(url);
    if (classified.platform && courseSpecific(url, classified.hints) && !genericVendorAsset(url, classified)) {
      if (seenHits.has(url)) return;
      seenHits.add(url);
      hits.push({ ...classified, via, evidence_page: pageUrl });
      return;
    }
    if (classified.platform) return;
    if (isLodgingBooking(url, text)) return;
    if (!bookingIntent(text, url) && !golfSection(text, url)) return;
    if (sameSite(url, pageUrl)) {
      if (seenFollow.has(url)) return;
      seenFollow.add(url);
      followups.push(url);
      return;
    }
    if (!courseSpecific(url, null) && !BOOKING_TEXT.test(String(text || ''))) return;
    if (seenUnknown.has(url)) return;
    seenUnknown.add(url);
    unknowns.push({
      booking_url: url,
      platform: null,
      hints: {},
      support: 'unknown_vendor',
      via,
      evidence_page: pageUrl,
    });
  }

  const anchorRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(flat))) {
    consider(attr(match[1], 'href'), 'anchor', visibleText(match[2]));
  }
  const tagRe = /<(iframe|script|form|embed)\b([^>]*)>/gi;
  while ((match = tagRe.exec(flat))) {
    const raw = attr(match[2], 'src') || attr(match[2], 'action');
    consider(raw, match[1].toLowerCase(), '');
  }
  const urlRe = /https?:\/\/[^\s"'<>]+/gi;
  let rawCount = 0;
  while ((match = urlRe.exec(flat)) && rawCount < 500) {
    rawCount += 1;
    consider(match[0], 'html', '');
  }

  for (const embedded of extractEmbeddedVendors(flat, pageUrl)) {
    if (seenHits.has(embedded.booking_url)) continue;
    seenHits.add(embedded.booking_url);
    hits.push(embedded);
  }

  return { hits, followups, unknowns };
}

export function discoverFromPages(pages) {
  const hits = [];
  const unknowns = [];
  const followups = [];
  const seenHit = new Set();
  const seenUnknown = new Set();
  const seenFollow = new Set();

  for (const page of pages || []) {
    const base = page?.finalUrl || page?.url;
    if (!base) continue;
    if (page.finalUrl && page.url && page.finalUrl !== page.url) {
      const redirected = classifyBookingUrl(page.finalUrl);
      if (redirected.platform && courseSpecific(page.finalUrl, redirected.hints) && !seenHit.has(page.finalUrl)) {
        seenHit.add(page.finalUrl);
        hits.push({ ...redirected, via: 'redirect', evidence_page: page.url });
      }
    }
    if (!page.html) continue;
    const found = inspectHtml(page.html, base);
    for (const hit of found.hits) {
      if (seenHit.has(hit.booking_url)) continue;
      seenHit.add(hit.booking_url);
      hits.push(hit);
    }
    for (const unknown of found.unknowns) {
      if (seenUnknown.has(unknown.booking_url)) continue;
      seenUnknown.add(unknown.booking_url);
      unknowns.push(unknown);
    }
    for (const url of found.followups) {
      if (seenFollow.has(url)) continue;
      seenFollow.add(url);
      followups.push(url);
    }
  }

  const pool = hits.length ? hits : unknowns;
  const best = pool.slice().sort((a, b) => scoreHit(b) - scoreHit(a))[0] || null;
  return { hits, unknowns, followups, best: best ? describeHit(best) : null };
}

export function describeHit(hit) {
  const named = hit?.platform || null;
  const platform = named || bookingHostKey(hit?.booking_url) || null;
  const hints = hit?.hints || {};
  const support = named ? supportFor(named, hints) : platform ? 'link_only' : hit?.support || 'unknown_vendor';
  const missing = platform ? missingHints(platform, hints) : [];
  let bookingStatus = 'pending';
  let note = '';
  if (support === 'live_ready') {
    bookingStatus = 'ready';
    if (platform === 'teeitup' && !hintPresent(hints.teeitup_course_id)) {
      note = 'TeeItUp course hash was not in the URL. The facility sheet still polls.';
    }
  } else if (support === 'live_missing_ids') {
    note = `Missing ${missing.join(', ')} for live tee times.`;
  } else if (support === 'link_only') {
    bookingStatus = 'unsupported';
    note = `${platform} is booking-link only.`;
  } else if (support === 'unknown_vendor') {
    note = `Unrecognized booking host: ${hostOf(hit?.booking_url)}`;
  }
  return {
    ...hit,
    platform,
    hints,
    support,
    missing,
    booking_status: bookingStatus,
    note,
  };
}

export function applyVendorEnrichment(hit, enrichment) {
  if (!hit) return null;
  if (!enrichment) return describeHit(hit);
  const hints = { ...(hit.hints || {}) };
  if (enrichment.schedule_id) hints.schedule_id = String(enrichment.schedule_id);
  if (enrichment.booking_class_id) hints.booking_class_id = String(enrichment.booking_class_id);
  if (enrichment.facility_id) hints.facility_id = String(enrichment.facility_id);
  if (enrichment.club_id) hints.club_id = String(enrichment.club_id);
  if (enrichment.course_id) hints.course_id = String(enrichment.course_id);
  if (enrichment.affiliation_type_id) hints.affiliation_type_id = String(enrichment.affiliation_type_id);
  if (Array.isArray(enrichment.course_ids) && enrichment.course_ids.length) {
    hints.course_ids = enrichment.course_ids.map(String);
  }
  const described = describeHit({
    ...hit,
    platform: enrichment.use_club_teetimes ? 'chronogolf_slc' : hit.platform,
    booking_url: enrichment.booking_url || hit.booking_url,
    hints,
  });
  const holes = Number(enrichment.meta?.holes);
  if (holes === 9 || holes === 18) described.holes = holes;
  if (Array.isArray(enrichment.schedule_ids) && enrichment.schedule_ids.length > 1 && !hints.schedule_id) {
    described.note = `Multiple ForeUp schedules (${enrichment.schedule_ids.join(', ')}). ${described.note || ''}`.trim();
  }
  return described;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function pageText(html) {
  return visibleText(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' '),
  );
}

function uniqueNumbers(values, accept) {
  return [...new Set(values.filter((value) => accept(value)))];
}

function collectDescriptions(node, out) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.description === 'string') out.push(decodeHtml(node.description));
  if (Array.isArray(node)) {
    for (const item of node) collectDescriptions(item, out);
    return;
  }
  if (Array.isArray(node['@graph'])) {
    for (const item of node['@graph']) collectDescriptions(item, out);
  }
}

function aboutFromHtml(html) {
  const source = String(html || '');
  const candidates = [];
  const meta = source.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)
    || source.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
    || source.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
  if (meta?.[1]) candidates.push(decodeHtml(meta[1]));
  for (const block of source.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || []) {
    const body = block.replace(/<\/?script[^>]*>/gi, '');
    try {
      const descriptions = [];
      collectDescriptions(JSON.parse(body), descriptions);
      candidates.push(...descriptions);
    } catch {
      // A course site can include broken JSON-LD beside a usable meta description.
    }
  }
  const about = candidates.find((text) => {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 8 || text.length > 600) return false;
    if (/cookie|privacy policy|javascript|enable cookies|lorem ipsum|skip to content/i.test(text)) return false;
    return true;
  });
  return about || '';
}

function phoneFromHtml(html) {
  const tel = String(html || '').match(/href\s*=\s*["']tel:([^"'?#]+)/i);
  if (!tel) return '';
  let decoded = tel[1];
  try {
    decoded = decodeURIComponent(tel[1]);
  } catch {
    decoded = tel[1];
  }
  const digits = decoded.replace(/\D/g, '');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (local.length !== 10) return '';
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

/** Holes, par, yardage, phone, and the about paragraph from a course homepage. */
export function extractCourseFacts(html) {
  const text = pageText(html);
  const holes = uniqueNumbers(
    [...text.matchAll(/\b(9|18)[\s-]*holes?\b/gi)].map((match) => Number(match[1])),
    (value) => value === 9 || value === 18,
  );
  const pars = uniqueNumbers(
    [...text.matchAll(/\bpar\s*[-:]?\s*(\d{2})\b/gi)].map((match) => Number(match[1])),
    (value) => value >= 27 && value <= 76,
  );
  const yardages = uniqueNumbers(
    [...text.matchAll(/\b(\d{1,2},\d{3}|\d{4,5})\s*(?:yards|yds)\b/gi)].map((match) =>
      Number(match[1].replace(/,/g, '')),
    ),
    (value) => value >= 1000 && value <= 8000,
  );
  return {
    holes: holes.length === 1 ? holes[0] : undefined,
    par: pars.length === 1 ? pars[0] : undefined,
    yardage: yardages.length ? Math.max(...yardages) : undefined,
    editorial_note: aboutFromHtml(html),
    phone: phoneFromHtml(html),
  };
}

export function looksBlocked(html, status) {
  const text = String(html || '');
  if (Number(status) === 202 && /captcha/i.test(text)) return true;
  if (/sgcaptcha|cf-browser-verification|Just a moment\.\.\./i.test(text) && text.length < 20000) return true;
  return false;
}

function pageKey(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '');
  }
}

function fetchedSummary(page, startUrl) {
  return {
    url: page?.url || startUrl,
    finalUrl: page?.finalUrl || page?.url || startUrl,
    status: page?.status || 0,
    error: page?.error || null,
    blocked: Boolean(page?.blocked),
    failed: pageUnusable(page),
  };
}

function mergeFacts(pages) {
  const facts = { holes: undefined, par: undefined, yardage: undefined, editorial_note: '', phone: '' };
  for (const page of pages) {
    if (!page?.html || pageUnusable(page)) continue;
    const next = extractCourseFacts(page.html);
    if (!facts.holes && next.holes) facts.holes = next.holes;
    if (!facts.par && next.par) facts.par = next.par;
    if (!facts.yardage && next.yardage) facts.yardage = next.yardage;
    if (!facts.editorial_note && next.editorial_note) facts.editorial_note = next.editorial_note;
    if (!facts.phone && next.phone) facts.phone = next.phone;
  }
  return facts;
}

/** Fetch the site, then up to a handful of same-site tee-time pages. */
export async function crawlBookingSite(startUrl, fetchPage, opts = {}) {
  const maxFollow = opts.maxFollow ?? 6;
  const first = await fetchPage(startUrl);
  if (pageUnusable(first)) {
    return {
      hits: [],
      unknowns: [],
      followups: [],
      best: null,
      facts: {},
      page_text: '',
      fetched: [fetchedSummary(first, startUrl)],
    };
  }
  const pages = [first];
  if (first?.html) {
    const preview = inspectHtml(first.html, first.finalUrl || first.url || startUrl);
    const seen = new Set([pageKey(startUrl), pageKey(first.finalUrl || ''), pageKey(first.url || '')]);
    const queue = [];
    for (const url of preview.followups) {
      const key = pageKey(url);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(url);
      if (queue.length >= maxFollow) break;
    }
    for (const url of queue) {
      pages.push(await fetchPage(url));
    }
  }
  const found = discoverFromPages(pages);
  const facts = mergeFacts(pages);
  return {
    ...found,
    facts,
    page_text: pageText(pages.find((page) => page?.html && !pageUnusable(page))?.html || '').slice(0, 1800),
    fetched: pages.map((page) => fetchedSummary(page, startUrl)),
  };
}

export function outcomeFromCrawl(crawl) {
  if (crawl?.best) return crawl.best;
  const fetchedOk = (crawl?.fetched || []).some(
    (page) => page.status >= 200 && page.status < 400 && !page.blocked && !page.failed,
  );
  const blocked = (crawl?.fetched || []).some((page) => page.blocked);
  if (!fetchedOk && blocked) {
    return {
      booking_url: '',
      platform: null,
      hints: {},
      support: 'fetch_failed',
      missing: [],
      booking_status: 'pending',
      note: 'The site blocked the fetch with a captcha.',
      via: null,
      evidence_page: null,
    };
  }
  if (!fetchedOk) {
    return {
      booking_url: '',
      platform: null,
      hints: {},
      support: 'fetch_failed',
      missing: [],
      booking_status: 'pending',
      note: 'Website did not load.',
      via: null,
      evidence_page: null,
    };
  }
  return {
    booking_url: '',
    platform: null,
    hints: {},
    support: 'none',
    missing: [],
    booking_status: 'pending',
    note: 'No online booking URL found.',
    via: null,
    evidence_page: null,
  };
}

export function shouldImport(course) {
  if (!course || course.catalog_match) return false;
  return ['live_ready', 'live_missing_ids', 'link_only', 'unknown_vendor', 'none', 'no_website'].includes(
    course.support,
  );
}

export function toImportRecord(course) {
  const record = {
    name: course.name,
    area: course.area || '',
    platform: course.platform || '',
    booking_url: course.booking_url || '',
    timezone: course.timezone || 'America/Denver',
    booking_status: course.booking_status || 'pending',
  };
  if (course.address) record.address = course.address;
  if (course.phone_number) record.phone_number = course.phone_number;
  if (course.website) record.website = course.website;
  if (course.google_place_id) record.google_place_id = course.google_place_id;
  if (course.photo_reference) record.photo_reference = course.photo_reference;
  if (course.note) record.booking_status_note = course.note;
  if (Number.isFinite(course.lat)) record.lat = course.lat;
  if (Number.isFinite(course.lng)) record.lng = course.lng;
  if (course.holes === 9 || course.holes === 18) record.holes = course.holes;
  const par = Number(course.par);
  if (Number.isInteger(par) && par >= 27 && par <= 76) record.par = par;
  const yardage = Number(course.yardage);
  if (Number.isInteger(yardage) && yardage >= 1000 && yardage <= 8000) record.yardage = yardage;
  const about = String(course.editorial_note || '').trim();
  if (about) record.editorial_note = about.slice(0, 600);
  for (const [key, value] of Object.entries(course.hints || {})) {
    if (!HINT_FIELDS.has(key) || !hintPresent(value)) continue;
    if (key === 'course_ids') {
      const ids = (Array.isArray(value) ? value : String(value).split(','))
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length) record.course_ids = ids;
      continue;
    }
    record[key] = String(value).trim();
  }
  return { slug: slugFromCourseName(course.name), record };
}
