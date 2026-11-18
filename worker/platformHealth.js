/**
 * Daily health check for tee-time polling.
 *
 * TeeSnap went dark on about 20 Sept 2026 and nothing noticed for two months,
 * and Lake Havasu had quietly moved from TeeSnap to Quick18. This check runs
 * once a day and emails the admins when:
 *   - a whole platform has no successful poll in 24 hours ("down"), or fewer
 *     than half its polled courses succeeded ("degraded");
 *   - a course has been polled but has not succeeded for 3+ days. For a few of
 *     those, the course's website is crawled again, and a booking link on a
 *     different vendor or host is reported as a likely vendor change.
 * Nothing is changed automatically; the email says what to look at. The last
 * report is kept in app_config under "platform_health".
 */

import { fetchAllRows } from './courseAdmin.js';
import { isPollableCourse } from './availabilityPoll.js';
import { discoverWebsite } from './stateDiscovery.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FAILING_AFTER_MS = 3 * DAY_MS;
const RECRAWL_LIMIT = 8;
const RUN_HOUR_UTC = 14; // 7–8 am Mountain

function hostOf(url) {
  try {
    return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Per-platform and per-course health from poll schedule rows.
 * @param courses       pollable courses (slug, name, platform, website, booking_url)
 * @param scheduleRows  [{ course_slug, last_polled_at, last_success_at }]
 */
export function summarizeHealth(courses, scheduleRows, now = Date.now()) {
  const bySlug = new Map(courses.map((c) => [c.slug, c]));
  const perCourse = new Map();
  for (const row of scheduleRows) {
    if (!bySlug.has(row.course_slug)) continue;
    const polled = Date.parse(row.last_polled_at || '') || 0;
    const success = Date.parse(row.last_success_at || '') || 0;
    const prev = perCourse.get(row.course_slug) || { polled: 0, success: 0 };
    perCourse.set(row.course_slug, { polled: Math.max(prev.polled, polled), success: Math.max(prev.success, success) });
  }
  const platforms = new Map();
  const failing = [];
  for (const [slug, seen] of perCourse) {
    if (now - seen.polled > DAY_MS) continue;
    const course = bySlug.get(slug);
    const p = platforms.get(course.platform) || { platform: course.platform, courses_polled: 0, courses_ok: 0 };
    p.courses_polled += 1;
    if (now - seen.success <= DAY_MS) p.courses_ok += 1;
    platforms.set(course.platform, p);
    if (!seen.success || now - seen.success > FAILING_AFTER_MS) {
      failing.push({
        slug,
        name: course.name,
        platform: course.platform,
        last_success_at: seen.success ? new Date(seen.success).toISOString() : null,
        website: course.website || '',
        booking_url: course.booking_url || '',
      });
    }
  }
  const platformList = [...platforms.values()]
    .map((p) => {
      const rate = p.courses_polled ? p.courses_ok / p.courses_polled : 1;
      const state = p.courses_polled >= 3 && p.courses_ok === 0 ? 'down' : rate < 0.5 ? 'degraded' : 'ok';
      return { ...p, ok_rate: Math.round(rate * 100) / 100, state };
    })
    .sort((a, b) => a.ok_rate - b.ok_rate || a.platform.localeCompare(b.platform));
  failing.sort((a, b) => (a.last_success_at || '').localeCompare(b.last_success_at || ''));
  return { platforms: platformList, failing };
}

/** A crawled link that points somewhere else than the course's current booking link. */
export function vendorChange(course, hit) {
  if (!hit?.platform || !hit.booking_url) return null;
  const now = hostOf(course.booking_url);
  const found = hostOf(hit.booking_url);
  if (hit.platform === course.platform && found === now) return null;
  return { platform: hit.platform, booking_url: hit.booking_url };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** Plain email body for the report; '' when there is nothing to report. */
export function healthEmail(report) {
  const bad = report.platforms.filter((p) => p.state !== 'ok');
  if (!bad.length && !report.failing.length) return '';
  const rows = (list, fmt) => list.map((x) => `<li>${fmt(x)}</li>`).join('');
  return [
    '<p>Tee-Time daily polling check.</p>',
    bad.length
      ? `<p><b>Platforms with problems</b></p><ul>${rows(bad, (p) => `${esc(p.platform)}: ${p.state}, ${p.courses_ok} of ${p.courses_polled} polled courses succeeded in 24 h`)}</ul>`
      : '',
    report.suggestions.length
      ? `<p><b>Courses that seem to have changed booking vendor</b> (check, then update in booking QA)</p><ul>${rows(report.suggestions, (s) => `${esc(s.name)}: now links to ${esc(s.platform)} <a href="${esc(s.booking_url)}">${esc(s.booking_url)}</a>`)}</ul>`
      : '',
    report.failing.length
      ? `<p><b>${report.failing.length} courses with no successful poll in 3+ days</b></p><ul>${rows(report.failing.slice(0, 25), (f) => `${esc(f.name)} (${esc(f.platform)}), last success ${f.last_success_at ? esc(f.last_success_at.slice(0, 10)) : 'never'}`)}</ul>${report.failing.length > 25 ? `<p>…and ${report.failing.length - 25} more.</p>` : ''}`
      : '',
  ].join('');
}

function sb(env, json = false) {
  const h = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function readConfig(env, key) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/app_config?key=eq.${key}&select=value`, { headers: sb(env) });
  if (!res.ok) return null;
  return (await res.json())?.[0]?.value ?? null;
}

async function writeConfig(env, key, value) {
  await fetch(`${env.SUPABASE_URL}/rest/v1/app_config?on_conflict=key`, {
    method: 'POST',
    headers: { ...sb(env, true), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
}

/** Admin email addresses: OPS_ALERT_EMAIL if set, else every profile marked admin. */
async function adminEmails(env) {
  const explicit = String(env.OPS_ALERT_EMAIL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (explicit.length) return explicit;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?select=id&is_admin=eq.true`, { headers: sb(env) });
  if (!res.ok) return [];
  const emails = [];
  for (const { id } of await res.json()) {
    const user = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${id}`, { headers: sb(env) });
    if (user.ok) {
      const email = (await user.json())?.email;
      if (email) emails.push(email);
    }
  }
  return emails;
}

/**
 * Runs the check once per UTC day at RUN_HOUR_UTC (or now when `force`).
 * deps: { loadCourses, sendEmail(env, to, subject, html) }
 */
export async function handlePlatformHealth(env, deps, { now = new Date(), force = false } = {}) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return null;
  const today = now.toISOString().slice(0, 10);
  if (!force) {
    if (now.getUTCHours() !== RUN_HOUR_UTC) return null;
    if ((await readConfig(env, 'platform_health_last_run')) === today) return null;
  }
  await writeConfig(env, 'platform_health_last_run', today);

  const courses = (await deps.loadCourses()).filter(isPollableCourse);
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const schedule = await fetchAllRows(
    env,
    `availability_poll_schedule?select=course_slug,last_polled_at,last_success_at&last_polled_at=gte.${encodeURIComponent(since)}&order=course_slug`,
    'availability_poll_schedule',
  );
  const { platforms, failing } = summarizeHealth(courses, schedule, now.getTime());

  const suggestions = [];
  for (const course of failing.filter((f) => f.website).slice(0, RECRAWL_LIMIT)) {
    const hit = await discoverWebsite(course.website).catch(() => null);
    const change = vendorChange(course, hit);
    if (change) suggestions.push({ slug: course.slug, name: course.name, from: course.platform, ...change });
  }

  const report = { checked_at: now.toISOString(), platforms, failing, suggestions };
  await writeConfig(env, 'platform_health', report);
  const html = healthEmail(report);
  if (html && deps.sendEmail) {
    const bad = platforms.filter((p) => p.state !== 'ok').map((p) => p.platform);
    const subject = bad.length ? `Tee-Time polling: ${bad.join(', ')} need a look` : `Tee-Time polling: ${failing.length} courses failing`;
    for (const to of await adminEmails(env)) await deps.sendEmail(env, to, subject, html);
  }
  return report;
}
