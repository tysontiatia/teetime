/**
 * Booking-link crawl for new courses from the course index.
 *
 * A row is queued by scripts/queue-course-crawl.mjs (one row per new club,
 * its main layout). Every 15 minutes the Worker takes a few queued rows,
 * crawls the course's own website for a tee sheet (the same crawler as state
 * discovery), checks the page with Jev, and saves the club as a hidden QA stub
 * (booking_status "pending"). Nothing goes public here: approval happens in
 * booking QA. A website that will not load is retried twice (after 1 h and
 * 6 h), then the stub is saved with what is known so a person can finish it.
 *
 * No Google calls: name, address, phone, website, and layout come from the
 * index, and stubs are not public, so the photo job skips them.
 */

import {
  fetchExistingCourseIndex,
  findImportDuplicate,
  normalizeImportStubRecord,
  saveCourse,
} from './courseAdmin.js';
import { toImportRecord } from './bookingDiscovery.js';
import { displayName } from './courseIndex.js';
import { checkIndexStubPage } from './courseValidity.js';
import { STATE_NAMES, discoverWebsite } from './stateDiscovery.js';
import { SHEET_PLATFORMS, listSheetsFor, planClubStubs, sheetFields } from './vendorSheets.js';

const CRAWL_BATCH = 3;
const RETRY_DELAYS_MS = [60 * 60 * 1000, 6 * 60 * 60 * 1000];

function sbHeaders(env, json = false) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

/**
 * The QA stub for a new club. `primary` is its main layout row, `layouts` all
 * of its rows, `hit` the crawler's result for the website (or null).
 * Returns { slug, record } with booking_status "pending".
 */
export function buildIndexStub(primary, layouts, hit, { split = false, note = '' } = {}) {
  const crawled = hit && hit.support !== 'fetch_failed' ? hit : null;
  const notes = [];
  if (!primary.website) notes.push('No course website in the index.');
  else if (!crawled) notes.push('Website did not load; finish the booking link by hand.');
  else if (crawled.note) notes.push(crawled.note);
  if (note) notes.push(note);
  const others = split ? [] : layouts.filter((r) => r.course_key !== primary.course_key && r.course_name);
  if (others.length) {
    notes.push(`18Birdies also lists ${others.map((r) => r.course_name).join(', ')}; split if they book separately.`);
  }
  // A club split into one course per tee sheet names each one "Club - Layout (City)".
  const baseName = split && primary.course_name ? `${primary.club_name} - ${primary.course_name}` : primary.club_name;
  const base = toImportRecord({
    name: displayName(baseName, primary.city),
    area: [STATE_NAMES[primary.state] || primary.state, primary.city].filter(Boolean).join(' · '),
    address: primary.address,
    phone_number: primary.phone || crawled?.phone_number || '',
    website: primary.website || '',
    timezone: primary.timezone,
    lat: primary.lat,
    lng: primary.lng,
    holes: primary.holes,
    par: primary.par,
    yardage: primary.yardage,
    editorial_note: crawled?.editorial_note || '',
    platform: crawled?.platform || '',
    booking_url: crawled?.booking_url || '',
    hints: crawled?.hints || {},
    booking_status: 'pending',
    note: notes.join(' '),
  });
  const record = normalizeImportStubRecord(base.record);
  record.booking_status = 'pending';
  record.state = primary.state;
  record.source = 'course_index';
  record.birdies_club_id = primary.club_id;
  record.birdies_course_key = primary.course_key;
  // The index zone is exact (geo-tz) for this pin; normalizeImportStubRecord
  // set the Worker's approximate one, which must not carry the exact stamp.
  if (primary.timezone && primary.timezone_pin) {
    record.timezone = primary.timezone;
    record.timezone_pin = primary.timezone_pin;
  }
  if (primary.tees?.length) record.tees = primary.tees;
  if (layouts.length > 1 && !split) record.index_layouts = layouts.map((r) => r.course_name).filter(Boolean);
  if (crawled?.og_image) record.photo_candidate_url = crawled.og_image;
  return { slug: base.slug, record };
}

/** Next crawl_status / crawl_next_at after a website that did not load. */
export function crawlRetryPlan(attempts, now = Date.now()) {
  const delay = RETRY_DELAYS_MS[attempts];
  return delay == null ? null : new Date(now + delay).toISOString();
}

async function claimRows(env) {
  const now = new Date().toISOString();
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_index?select=*` +
      `&crawl_status=in.(queued,retry)` +
      `&or=(crawl_next_at.is.null,crawl_next_at.lte.${encodeURIComponent(now)})` +
      `&order=crawl_next_at.asc.nullsfirst,course_key.asc&limit=${CRAWL_BATCH}`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) {
    console.error('[index-crawl] queue read failed', res.status, (await res.text()).slice(0, 200));
    return [];
  }
  const rows = await res.json();
  const claimed = [];
  for (const row of rows) {
    // Conditional update: only one tick can move a row from queued/retry to crawling.
    const patch = await fetch(
      `${env.SUPABASE_URL}/rest/v1/course_index?course_key=eq.${encodeURIComponent(row.course_key)}&crawl_status=eq.${row.crawl_status}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders(env, true), Prefer: 'return=representation' },
        body: JSON.stringify({ crawl_status: 'crawling', updated_at: now }),
      },
    );
    if (patch.ok && (await patch.json()).length === 1) claimed.push(row);
  }
  return claimed;
}

async function clubRows(env, clubId) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/course_index?select=*&club_id=eq.${clubId}&order=course_position.asc`,
    { headers: sbHeaders(env) },
  );
  return res.ok ? res.json() : [];
}

async function updateClub(env, clubId, fields) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/course_index?club_id=eq.${clubId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env, true), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

async function updateRow(env, courseKey, fields) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/course_index?course_key=eq.${encodeURIComponent(courseKey)}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(env, true), Prefer: 'return=minimal' },
    body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
  });
}

/**
 * What a crawl of one new club creates: one stub, one per tee sheet, or one
 * with the booking link rejected. Used by the Worker crawl and the preview.
 * @returns {{ plans: { layout, hit, note }[], split: boolean }}
 */
export async function planClubCrawl(row, clubLayouts, hit) {
  // Check the crawled account against the club and split it per tee sheet
  // (ForeUp, TeeItUp, Chronogolf publish sheet names; others keep one stub).
  let plans = [{ layout: row, hit, note: '' }];
  let split = false;
  if (hit?.platform && hit.booking_url && SHEET_PLATFORMS.has(hit.platform)) {
    const info = await listSheetsFor(hit.platform, { booking_url: hit.booking_url, ...(hit.hints || {}) });
    const plan = planClubStubs(row, clubLayouts, info);
    if (plan.reject) {
      plans = [{ layout: row, hit: { ...hit, platform: '', booking_url: '', hints: {}, support: 'rejected_account' }, note: plan.reject }];
    } else {
      split = plan.plans.length > 1;
      plans = [];
      for (const p of plan.plans) {
        let planHit = hit;
        if (p.sheet) {
          const fields = (await sheetFields(hit.platform, p.sheet, info.context)) || {};
          const { booking_url: sheetUrl, holes: _holes, ...hints } = fields;
          planHit = { ...hit, booking_url: sheetUrl || hit.booking_url, hints: { ...(hit.hints || {}), ...hints } };
        }
        plans.push({ layout: p.layout, hit: planHit, note: p.note });
      }
    }
  }

  return { plans, split };
}

async function crawlOne(env, row, existing) {
  const hit = row.website ? await discoverWebsite(row.website) : null;
  const attempts = (row.crawl_attempts || 0) + 1;
  if (hit?.support === 'fetch_failed') {
    const next = crawlRetryPlan(attempts - 1);
    if (next) {
      await updateRow(env, row.course_key, { crawl_status: 'retry', crawl_attempts: attempts, crawl_next_at: next, crawl_result: { support: 'fetch_failed', note: hit.note || '' } });
      return 'retry';
    }
  }
  const layouts = (await clubRows(env, row.club_id)).filter(Boolean);
  const clubLayouts = layouts.length ? layouts : [row];

  const { plans, split } = await planClubCrawl(row, clubLayouts, hit);

  const results = [];
  for (const plan of plans) {
    const stub = buildIndexStub(plan.layout, clubLayouts, plan.hit, { split, note: plan.note });
    const check = await checkIndexStubPage({ ...stub.record, page_text: hit?.page_text || '' }, env);
    for (const field of check.drop) delete stub.record[field];
    if (check.drop.length) {
      stub.record.booking_status_note = `${stub.record.booking_status_note || ''} Page check dropped: ${check.drop.join(', ')}.`.trim();
    }
    const result = {
      support: plan.hit?.support || 'no_website',
      platform: stub.record.platform || null,
      booking_url: stub.record.booking_url || null,
      og_image: stub.record.photo_candidate_url || null,
      page_check: check.checked ? check.drop : 'not_run',
      stub_slug: stub.slug,
    };
    const dup = findImportDuplicate(existing, stub.slug, stub.record);
    if (dup) {
      results.push({ layout: plan.layout, outcome: 'duplicate', result: { ...result, duplicate_of: dup.matched_slug }, note: `Crawl found an existing course: ${dup.matched_name} (${dup.matched_slug}, ${dup.reason}).` });
      continue;
    }
    const saved = await saveCourse(env, { slug: stub.slug, record: stub.record, prepaid: false, rates: {}, isNew: true });
    if (saved.error) {
      results.push({ layout: plan.layout, outcome: 'failed', result: { ...result, error: saved.error, detail: saved.detail || null } });
      continue;
    }
    existing.bySlug.set(stub.slug, { slug: stub.slug, name: stub.record.name, address: stub.record.address || '', area: stub.record.area || '', timezone: stub.record.timezone || '', google_place_id: '' });
    existing.list.push(existing.bySlug.get(stub.slug));
    results.push({ layout: plan.layout, outcome: 'imported', result, note: split ? 'Imported as a hidden QA stub (one per tee sheet).' : 'Imported as a hidden QA stub.' });
  }

  // Every layout of the club points at the stub it belongs to (or the first one).
  const imported = results.filter((r) => r.outcome === 'imported');
  const first = imported[0] || results[0];
  await updateClub(env, row.club_id, {
    registry_slug: imported[0]?.result.stub_slug || null,
    crawl_status: first.outcome === 'imported' ? 'imported' : first.outcome,
    crawl_attempts: attempts,
    crawl_result: first.result,
    ...(first.outcome === 'duplicate' ? { match_status: 'review' } : {}),
    match_note: first.note || null,
  });
  for (const r of results.slice(1)) {
    await updateRow(env, r.layout.course_key, {
      registry_slug: r.outcome === 'imported' ? r.result.stub_slug : null,
      crawl_status: r.outcome,
      crawl_result: r.result,
      match_note: r.note || null,
      ...(r.outcome === 'duplicate' ? { match_status: 'review' } : {}),
    });
  }
  return first.outcome;
}

export async function handleCourseIndexCrawl(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return { crawled: 0 };
  const rows = await claimRows(env);
  if (!rows.length) return { crawled: 0 };
  const existing = await fetchExistingCourseIndex(env);
  const counts = {};
  for (const row of rows) {
    let outcome;
    try {
      outcome = await crawlOne(env, row, existing);
    } catch (err) {
      const attempts = (row.crawl_attempts || 0) + 1;
      const next = crawlRetryPlan(attempts - 1);
      outcome = next ? 'retry' : 'failed';
      await updateRow(env, row.course_key, {
        crawl_status: next ? 'retry' : 'failed',
        crawl_attempts: attempts,
        crawl_next_at: next,
        crawl_result: { error: String(err?.message || err).slice(0, 300) },
      });
    }
    counts[outcome] = (counts[outcome] || 0) + 1;
  }
  console.log('[index-crawl]', JSON.stringify(counts));
  return counts;
}
