/**
 * Tee-time alert delivery — event-driven (poll diff) + scheduled backstop.
 *
 * Trust model:
 * • Event path: notify on opened/reopened slots that match an active alert (fast).
 * • Reopened slots may re-notify after a short anti-spam window (15 min).
 * • Backstop cron: catch anything missed; only sends slots not notified in 24h.
 */

const MT = 'America/Denver';
const SLOT_REOPEN_COOLDOWN_MS = 15 * 60 * 1000;
const SLOT_OPEN_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const BACKSTOP_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function sbHeaders(env, json = false) {
  const h = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function addDaysToYmd(ymd, addDays) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays)).toISOString().slice(0, 10);
}

function ymdWeekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function mtTodayYmd() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: MT,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function slotNotifyKey(startsAtLocal, holes) {
  const m = String(startsAtLocal || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return `${startsAtLocal}|${holes}`;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}:00|${holes}`;
}

function localToRawTime(startsAtLocal) {
  const m = String(startsAtLocal || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return startsAtLocal;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

function formatTime12h(timeStr) {
  const match = String(timeStr || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return timeStr;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function formatPrice(cents) {
  if (cents == null) return null;
  return `$${Math.round(cents / 100)}`;
}

function displayCourseName(name) {
  const i = String(name || '').indexOf(' (');
  return i > 0 ? name.slice(0, i) : name;
}

function prefAppliesOnDate(pref, playDate, todayMt) {
  if (pref.target_date) return pref.target_date === playDate;
  if (pref.target_date != null || pref.look_ahead_days == null) return false;
  const horizon = Math.min(Math.max(Number(pref.look_ahead_days) || 14, 1), 60);
  if (playDate < todayMt || playDate > addDaysToYmd(todayMt, horizon - 1)) return false;
  const dowAllow = Array.isArray(pref.days_of_week) && pref.days_of_week.length
    ? pref.days_of_week
    : [0, 1, 2, 3, 4, 5, 6];
  return dowAllow.includes(ymdWeekday(playDate));
}

function slotMatchesPref(pref, slot) {
  const raw = slot.rawTime;
  const earliest = pref.earliest_time?.slice(0, 5) || '00:00';
  const latest = pref.latest_time?.slice(0, 5) || '23:59';
  const minSpots = pref.min_spots || pref.players || 1;
  if (raw < earliest || raw > latest) return false;
  if (slot.spots_open != null && slot.spots_open < minSpots) return false;
  return true;
}

function eventToSlot(event) {
  return {
    rawTime: localToRawTime(event.starts_at_local),
    holes: event.holes === 9 ? 9 : 18,
    spots_open: event.spots_open ?? null,
    price: formatPrice(event.price_cents),
    event_type: event.event_type,
    slotKey: slotNotifyKey(event.starts_at_local, event.holes),
  };
}

function buildOpeningSms(ctx, course, slots, playDate, players, eventType) {
  const bookingUrl = ctx.buildBookingUrlWorker(course, playDate, '18', String(players));
  const dateFormatted = new Date(playDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: MT,
  });
  const courseLabel = displayCourseName(course.name);

  if (slots.length === 1) {
    const s = slots[0];
    const time = formatTime12h(s.rawTime);
    const verb = eventType === 'reopened' ? 'just reopened' : 'just opened';
    const price = s.price ? ` — ${s.price}` : '';
    return (
      `⛳ ${time} ${verb} at ${courseLabel} on ${dateFormatted}${price}. ` +
      `${players} player${players !== 1 ? 's' : ''}.\nBook: ${bookingUrl}`
    );
  }

  return ctx.buildAlertSms(course, slots, playDate, players);
}

function buildOpeningEmailSubject(course, slots, eventType) {
  const verb = eventType === 'reopened' ? 'reopened' : 'opened';
  if (slots.length === 1) {
    return `⛳ ${formatTime12h(slots[0].rawTime)} ${verb} at ${displayCourseName(course.name)}`;
  }
  return `⛳ ${slots.length} tee time${slots.length !== 1 ? 's' : ''} at ${displayCourseName(course.name)}`;
}

async function loadPrefsForCourseDate(env, courseName, playDate, todayMt) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/notification_preferences?active=eq.true&course_id=eq.${encodeURIComponent(courseName)}&select=*`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return rows.filter((p) => prefAppliesOnDate(p, playDate, todayMt));
}

async function loadRecentLogs(env, userIds, logSinceStr) {
  if (!userIds.length) return [];
  const base =
    `${env.SUPABASE_URL}/rest/v1/notification_log?user_id=in.(${userIds.join(',')})` +
    `&sent_at=gte.${logSinceStr}&order=sent_at.desc`;
  let res = await fetch(
    `${base}&select=user_id,course_id,target_date,channel,sent_at,notified_slot_keys,notify_reason`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) {
    res = await fetch(
      `${base}&select=user_id,course_id,target_date,channel,sent_at,notified_slot_keys`,
      { headers: sbHeaders(env) },
    );
  }
  if (!res.ok) {
    res = await fetch(
      `${base}&select=user_id,course_id,target_date,channel,sent_at`,
      { headers: sbHeaders(env) },
    );
  }
  return res.ok ? res.json() : [];
}

function appendLog(logs, row) {
  logs.push({ ...row, sent_at: new Date().toISOString() });
}

function slotLastNotifiedAt(logs, userId, courseId, playDate, channel, slotKey) {
  let latest = 0;
  for (const log of logs) {
    if (log.user_id !== userId || log.course_id !== courseId || log.target_date !== playDate || log.channel !== channel) {
      continue;
    }
    const keys = log.notified_slot_keys || [];
    if (!keys.includes(slotKey)) continue;
    const ts = new Date(log.sent_at).getTime();
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest;
}

function recentlyNotifiedKeys(logs, userId, courseId, playDate, channel, withinMs) {
  const cutoff = Date.now() - withinMs;
  const keys = new Set();
  for (const log of logs) {
    if (log.user_id !== userId || log.course_id !== courseId || log.target_date !== playDate || log.channel !== channel) {
      continue;
    }
    const ts = new Date(log.sent_at).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    for (const k of log.notified_slot_keys || []) keys.add(k);
  }
  return keys;
}

function filterSlotsForNotify(slots, pref, logs, playDate, { eventMode, channel }) {
  const out = [];
  for (const slot of slots) {
    if (!slotMatchesPref(pref, slot)) continue;

    if (eventMode) {
      const lastAt = slotLastNotifiedAt(logs, pref.user_id, pref.course_id, playDate, channel, slot.slotKey);
      const cooldown = slot.event_type === 'reopened' ? SLOT_REOPEN_COOLDOWN_MS : SLOT_OPEN_COOLDOWN_MS;
      if (lastAt && Date.now() - lastAt < cooldown) continue;
      // Reopened: allow even if in 24h set, as long as reopen cooldown passed
      if (slot.event_type !== 'reopened') {
        const recent = recentlyNotifiedKeys(
          logs, pref.user_id, pref.course_id, playDate, channel, SLOT_OPEN_COOLDOWN_MS,
        );
        if (recent.has(slot.slotKey)) continue;
      }
    } else {
      const recent = recentlyNotifiedKeys(
        logs, pref.user_id, pref.course_id, playDate, channel, BACKSTOP_LOOKBACK_MS,
      );
      if (recent.has(slot.slotKey)) continue;
    }
    out.push(slot);
  }
  return out;
}

/** Max backstop SMS per user per hour — avoids carrier/Twilio throttling after poll bursts. */
const MAX_BACKSTOP_SMS_PER_HOUR = 2;

function backstopSmsRateLimited(logs, userId) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let count = 0;
  for (const log of logs) {
    if (log.user_id !== userId || log.channel !== 'sms' || log.notify_reason !== 'backstop') continue;
    const ts = new Date(log.sent_at).getTime();
    if (Number.isFinite(ts) && ts > cutoff) count++;
  }
  return count >= MAX_BACKSTOP_SMS_PER_HOUR;
}

function slotsForAlertEmail(slots) {
  return slots.map((s) => ({
    rawTime: s.rawTime,
    price: s.price,
    spots: s.spots_open ?? s.spots ?? null,
  }));
}

async function loadUserAndProfile(env, userId) {
  const [userRes, profileRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: sbHeaders(env) }),
    fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=phone,notify_via,phone_verified_at`, { headers: sbHeaders(env) }),
  ]);
  if (!userRes.ok) return null;
  const user = await userRes.json();
  const profiles = profileRes.ok ? await profileRes.json() : [];
  return { user, profile: profiles[0] || {} };
}

function twilioConfigured(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

function normalizePhone(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return null;
}

async function writeNotificationLog(env, row) {
  const post = (body) =>
    fetch(`${env.SUPABASE_URL}/rest/v1/notification_log`, {
      method: 'POST',
      headers: sbHeaders(env, true),
      body: JSON.stringify(body),
    });

  const res = await post(row);
  if (res.ok) return;

  // Graceful fallback if slot-dedupe migration not applied yet.
  if (res.status === 400 || res.status === 422) {
    const { notified_slot_keys: _k, notify_reason: _r, ...legacy } = row;
    await post(legacy);
  }
}

async function deliverToUser(ctx, {
  pref,
  playDate,
  slots,
  notifyReason,
  eventType,
  logs,
}) {
  const { env } = ctx;
  const { user, profile } = await loadUserAndProfile(env, pref.user_id);
  if (!user) return;

  const notifyVia = profile.notify_via || 'email';
  const wantEmail = notifyVia === 'email' || notifyVia === 'both';
  const phoneE164 = normalizePhone(profile.phone);
  const smsVerified = Boolean(profile.phone_verified_at);
  const wantSms = (notifyVia === 'sms' || notifyVia === 'both') && phoneE164 && smsVerified;
  const players = pref.players || 1;
  const slotKeys = slots.map((s) => s.slotKey);
  const primaryEvent = eventType || slots[0]?.event_type || 'opened';

  const course = ctx.findCourseByCatalogId(ctx.courses, pref.course_id);
  if (!course) return;

  const eventMode = notifyReason === 'event';

  if (wantEmail && user.email) {
    if (!ctx.resendConfigured?.(env)) {
      if (!ctx._warnedResendMissing) {
        console.warn('[notifications] RESEND_API_KEY missing; email alerts skipped');
        ctx._warnedResendMissing = true;
      }
    } else {
      const emailSlots = filterSlotsForNotify(slots, pref, logs, playDate, {
        eventMode,
        channel: 'email',
      });
      if (emailSlots.length) {
        const subject = buildOpeningEmailSubject(course, emailSlots, primaryEvent);
        const html = ctx.buildAlertEmail(course, slotsForAlertEmail(emailSlots), playDate, players);
        const sent = await ctx.sendEmail(env, user.email, subject, html);
        if (sent) {
          await writeNotificationLog(env, {
            user_id: pref.user_id,
            course_id: pref.course_id,
            target_date: playDate,
            channel: 'email',
            times_found: emailSlots.length,
            notified_slot_keys: emailSlots.map((s) => s.slotKey),
            notify_reason: notifyReason,
          });
          appendLog(logs, {
            user_id: pref.user_id,
            course_id: pref.course_id,
            target_date: playDate,
            channel: 'email',
            notified_slot_keys: emailSlots.map((s) => s.slotKey),
            notify_reason: notifyReason,
          });
        }
      }
    }
  }

  if (wantSms) {
    if (!twilioConfigured(env)) return;
    if (!eventMode && backstopSmsRateLimited(logs, pref.user_id)) {
      console.warn(`[notifications] backstop SMS rate limit for user ${pref.user_id}`);
      return;
    }
    const smsSlots = filterSlotsForNotify(slots, pref, logs, playDate, {
      eventMode,
      channel: 'sms',
    });
    if (!smsSlots.length) return;

    const body = eventMode
      ? buildOpeningSms(ctx, course, smsSlots, playDate, players, primaryEvent)
      : ctx.buildAlertSms(course, smsSlots, playDate, String(players));

    const sent = await ctx.sendSms(env, phoneE164, body);
    if (sent) {
      await writeNotificationLog(env, {
        user_id: pref.user_id,
        course_id: pref.course_id,
        target_date: playDate,
        channel: 'sms',
        times_found: smsSlots.length,
        notified_slot_keys: smsSlots.map((s) => s.slotKey),
        notify_reason: notifyReason,
      });
        appendLog(logs, {
          user_id: pref.user_id,
          course_id: pref.course_id,
          target_date: playDate,
          channel: 'sms',
          notified_slot_keys: smsSlots.map((s) => s.slotKey),
          notify_reason: notifyReason,
        });
    }
  }
}

/**
 * Called immediately after poll diff detects opened/reopened slots.
 */
export async function notifyOnPollEvents(ctx, { course, playDate, notifyEvents, todayMt }) {
  if (!notifyEvents?.length || !ctx?.env?.SUPABASE_URL) return;

  const interesting = notifyEvents.filter((e) => e.event_type === 'opened' || e.event_type === 'reopened');
  if (!interesting.length) return;

  const prefs = await loadPrefsForCourseDate(ctx.env, course.name, playDate, todayMt || mtTodayYmd());
  if (!prefs.length) return;

  const slots = interesting.map(eventToSlot);
  const userIds = [...new Set(prefs.map((p) => p.user_id))];
  const logSince = addDaysToYmd(mtTodayYmd(), -45);
  const logs = await loadRecentLogs(ctx.env, userIds, logSince);

  const primaryEvent = interesting.some((e) => e.event_type === 'reopened') ? 'reopened' : 'opened';

  for (const pref of prefs) {
    const matching = filterSlotsForNotify(slots, pref, logs, playDate, { eventMode: true });
    if (!matching.length) continue;
    await deliverToUser(ctx, {
      pref,
      playDate,
      slots: matching,
      notifyReason: 'event',
      eventType: primaryEvent,
      logs,
    });
  }
}

/**
 * Scheduled backstop — scans prefs and open inventory for slots not yet notified.
 */
export async function runNotificationBackstop(ctx, { fetchSnapshotNormalizedTimes, fetchTimesForCourse, normalizeTimesWorker }) {
  const { env } = ctx;
  const courses = ctx.courses;
  const todayStr = mtTodayYmd();
  const cutoffStr = addDaysToYmd(todayStr, 14);
  const logSinceStr = addDaysToYmd(todayStr, -45);

  const [specRes, openRes] = await Promise.all([
    fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_preferences?active=eq.true&target_date=not.is.null&target_date=gte.${todayStr}&select=*`,
      { headers: sbHeaders(env) },
    ),
    fetch(
      `${env.SUPABASE_URL}/rest/v1/notification_preferences?active=eq.true&target_date=is.null&look_ahead_days=not.is.null&select=*`,
      { headers: sbHeaders(env) },
    ),
  ]);

  const specificPrefs = specRes.ok ? await specRes.json() : [];
  const openPrefs = openRes.ok ? await openRes.json() : [];
  const activeSpecific = specificPrefs.filter((p) => p.target_date && p.target_date <= cutoffStr);

  /** @type {{ pref: object, evalDate: string }[]} */
  const work = [];
  for (const pref of activeSpecific) {
    work.push({ pref, evalDate: pref.target_date });
  }
  for (const pref of openPrefs) {
    const horizon = Math.min(Math.max(Number(pref.look_ahead_days) || 14, 1), 60);
    const dowAllow = Array.isArray(pref.days_of_week) && pref.days_of_week.length ? pref.days_of_week : [0, 1, 2, 3, 4, 5, 6];
    for (let d = 0; d < horizon; d++) {
      const evalDate = addDaysToYmd(todayStr, d);
      if (evalDate < todayStr) continue;
      if (!dowAllow.includes(ymdWeekday(evalDate))) continue;
      work.push({ pref, evalDate });
    }
  }

  if (!work.length) return;

  const userIds = [...new Set(work.map((w) => w.pref.user_id))];
  const logs = await loadRecentLogs(env, userIds, logSinceStr);

  const groups = {};
  for (const item of work) {
    const k = `${item.pref.course_id}||${item.evalDate}`;
    if (!groups[k]) groups[k] = { course_id: item.pref.course_id, evalDate: item.evalDate, items: [] };
    groups[k].items.push(item);
  }

  for (const group of Object.values(groups)) {
    const course = ctx.findCourseByCatalogId(courses, group.course_id);
    if (!course) continue;

    const maxPlayers = Math.min(4, Math.max(1, ...group.items.map((it) => Number(it.pref.players || it.pref.min_spots || 1))));
    const courseSlug = course.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const snapshot = await fetchSnapshotNormalizedTimes(env, courseSlug, group.evalDate, '18', maxPlayers);
    let allTimes;
    if (snapshot.has_poll_coverage) {
      allTimes = snapshot.times;
    } else {
      const data = await fetchTimesForCourse(course, group.evalDate, '18', String(maxPlayers));
      if (!data) continue;
      allTimes = normalizeTimesWorker(course, data, '18');
    }
    if (!allTimes.length) continue;

    for (const item of group.items) {
      const { pref, evalDate } = item;
      const slots = allTimes
        .filter((t) => slotMatchesPref(pref, {
          rawTime: t.rawTime,
          spots_open: t.spots ?? null,
          holes: 18,
        }))
        .map((t) => ({
          rawTime: t.rawTime,
          holes: 18,
          spots_open: t.spots ?? null,
          price: t.price || null,
          slotKey: slotNotifyKey(`${t.rawTime}:00`, 18),
          event_type: 'opened',
        }));

      const newSlots = filterSlotsForNotify(slots, pref, logs, evalDate, { eventMode: false });
      if (!newSlots.length) continue;

      await deliverToUser(ctx, {
        pref,
        playDate: evalDate,
        slots: newSlots,
        notifyReason: 'backstop',
        eventType: 'opened',
        logs,
      });
    }
  }
}

export { mtTodayYmd };
