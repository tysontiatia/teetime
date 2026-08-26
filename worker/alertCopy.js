/**
 * Alert notification copy + email HTML — brand-aligned (docs/BRAND.md).
 * Emails use light theme tokens (clients rarely honor dark mode well).
 */

export const EMAIL_BRAND = {
  paper: '#FBFBF8',
  card: '#FFFFFF',
  ink: '#141E19',
  muted: '#4C5A53',
  subtle: '#8A958F',
  pine: '#1E4D3B',
  pineDeep: '#143528',
  /** UI fairway — lime CTA signal */
  fairway: '#C6F24E',
  fairwayInk: '#0B120E',
  greenSoft: '#F0FADB',
  line: '#E4E2DA',
  sand: '#EFECE3',
  /** Dark header → dark mark (lime tile) */
  logoUrl: 'https://tee-time.io/logo-icon-dark.svg',
  siteUrl: 'https://tee-time.io',
  accountUrl: 'https://tee-time.io/app/account/',
  fontBody: "'Schibsted Grotesk',ui-sans-serif,system-ui,-apple-system,sans-serif",
  fontDisplay: "'Familjen Grotesk',ui-sans-serif,system-ui,sans-serif",
  fontMono: "'IBM Plex Mono',ui-monospace,Menlo,Consolas,monospace",
};

export function displayCourseName(name) {
  const i = String(name || '').indexOf(' (');
  return i > 0 ? name.slice(0, i) : name;
}

export function formatTime12h(timeStr) {
  const match = String(timeStr || '').match(/(\d{1,2}):(\d{2})/);
  if (!match) return timeStr;
  let h = parseInt(match[1], 10);
  const m = match[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

export function holesLabel(holes) {
  if (holes === 9) return '9 holes';
  if (holes === 18) return '18 holes';
  return null;
}

export function slotHoles(slot) {
  return slot?.holes === 9 ? 9 : slot?.holes === 18 ? 18 : null;
}

/** Primary booking holes for a set of notified slots. */
export function bookingHolesForSlots(times) {
  if (times?.length === 1) {
    const h = slotHoles(times[0]);
    if (h) return String(h);
  }
  return '18';
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function verbForEvent(eventType) {
  if (eventType === 'reopened') return 'reopened';
  if (eventType === 'opened') return 'opened';
  return 'available';
}

function slotDetailLine(t) {
  const parts = [];
  const holes = holesLabel(slotHoles(t));
  if (holes) parts.push(holes);
  if (t.price) parts.push(t.price);
  if (t.spots != null) parts.push(`${t.spots} spot${t.spots !== 1 ? 's' : ''}`);
  return parts.join(' · ');
}

const MT = 'America/Denver';
const DOW_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatClock12h(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return hhmm || '';
  return formatTime12h(`${m[1]}:${m[2]}`);
}

/** Map stored earliest/latest to the UI window labels. */
export function windowLabelFromRange(earliest, latest) {
  const e = String(earliest || '').slice(0, 5);
  const l = String(latest || '').slice(0, 5);
  if (e === '05:00' && l.startsWith('11:59')) return 'Morning';
  if (e === '12:00' && l.startsWith('16:59')) return 'Afternoon';
  if (e === '17:00' && l.startsWith('21:00')) return 'Twilight';
  if ((e === '00:00' || !e) && (l.startsWith('23:59') || !l)) return 'All day';
  return 'Custom';
}

function formatPlayDateLong(ymd) {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: MT,
  });
}

function formatPlayDateShort(ymd) {
  return new Date(`${ymd}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: MT,
  });
}

/**
 * Restate the user's saved Alert so the notification keeps context.
 * @returns {{
 *   kind: 'one-time'|'weekly',
 *   title: string,
 *   scheduleLine: string,
 *   filtersLine: string,
 *   matchLine: string|null,
 *   summaryLine: string,
 * }}
 */
export function describeAlertPreference(pref, playDate) {
  const players = pref.players || pref.min_spots || 1;
  const playersLabel = `${players} player${players !== 1 ? 's' : ''}`;
  const windowName = windowLabelFromRange(pref.earliest_time, pref.latest_time);
  const earliest = formatClock12h(pref.earliest_time);
  const latest = formatClock12h(pref.latest_time);
  const windowDetail =
    windowName === 'All day'
      ? 'All day'
      : windowName === 'Custom' && earliest && latest
        ? `${earliest}–${latest}`
        : windowName;

  const filtersLine = `${windowDetail} · ${playersLabel}`;

  if (pref.target_date) {
    const scheduleLine = formatPlayDateLong(pref.target_date);
    return {
      kind: 'one-time',
      title: 'Your one-time Alert',
      scheduleLine,
      filtersLine,
      matchLine: null,
      summaryLine: `One-time · ${formatPlayDateShort(pref.target_date)} · ${filtersLine}`,
    };
  }

  const days = (Array.isArray(pref.days_of_week) ? pref.days_of_week : [])
    .slice()
    .sort((a, b) => a - b);
  const scheduleLine =
    days.length === 1
      ? DOW_PLURAL[days[0]] ?? 'Weekly'
      : days.length
        ? days.map((i) => DOW_FULL[i] ?? '?').join(', ')
        : 'Any day';

  const matchLine = playDate
    ? `Matched ${formatPlayDateLong(playDate)}`
    : null;

  return {
    kind: 'weekly',
    title: 'Your weekly Alert',
    scheduleLine,
    filtersLine,
    matchLine,
    summaryLine: `Weekly · ${scheduleLine} · ${filtersLine}`,
  };
}

/**
 * Email / push / SMS subject line — lead with the fact (BRAND voice).
 * e.g. "2:40 PM · 18 holes reopened at The Ridge"
 */
export function buildAlertSubject(course, slots, eventType) {
  const courseLabel = displayCourseName(course.name);
  const verb = verbForEvent(eventType);
  if (slots.length === 1) {
    const t = slots[0];
    const holes = holesLabel(slotHoles(t));
    const holesBit = holes ? ` · ${holes}` : '';
    return `${formatTime12h(t.rawTime)}${holesBit} ${verb} at ${courseLabel}`;
  }
  return `${slots.length} times ${verb} at ${courseLabel}`;
}

export function buildAlertHeadline(slots, eventType) {
  if (slots.length === 1) {
    const holes = holesLabel(slotHoles(slots[0]));
    const holesBit = holes ? ` · ${holes}` : '';
    if (eventType === 'reopened') return `${formatTime12h(slots[0].rawTime)}${holesBit} just reopened`;
    if (eventType === 'opened') return `${formatTime12h(slots[0].rawTime)}${holesBit} just opened`;
    return `${formatTime12h(slots[0].rawTime)}${holesBit} available`;
  }
  return `${slots.length} times match your Alert`;
}

function renderAlertContextBlock(alertSummary, b) {
  if (!alertSummary) return '';
  const matchRow = alertSummary.matchLine
    ? `<tr>
        <td style="padding:0 0 0;font-size:13px;color:${b.muted};line-height:1.45">${escapeHtml(alertSummary.matchLine)}</td>
      </tr>`
    : '';
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:16px 0 4px;border:1px solid ${b.line};border-radius:18px;background:${b.sand}">
      <tr>
        <td style="padding:14px 16px">
          <div style="font-family:${b.fontMono};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${b.pine};margin-bottom:8px">${escapeHtml(alertSummary.title)}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr>
              <td style="padding:0 0 4px;font-size:15px;font-weight:600;color:${b.ink};line-height:1.35;font-family:${b.fontDisplay}">${escapeHtml(alertSummary.scheduleLine)}</td>
            </tr>
            <tr>
              <td style="padding:0 0 ${alertSummary.matchLine ? '4px' : '0'};font-family:${b.fontMono};font-size:13px;color:${b.muted};line-height:1.45">${escapeHtml(alertSummary.filtersLine)}</td>
            </tr>
            ${matchRow}
          </table>
        </td>
      </tr>
    </table>`;
}

/**
 * @param {object} options
 * @param {string} options.bookingUrl
 * @param {string} [options.eventType]
 * @param {ReturnType<typeof describeAlertPreference>} [options.alertSummary]
 * @param {string} [options.alertPrefLine] legacy one-liner fallback
 */
export function buildAlertEmail(course, times, date, players, options = {}) {
  const { eventType, alertSummary, alertPrefLine, bookingUrl = EMAIL_BRAND.siteUrl } = options;
  const courseLabel = escapeHtml(displayCourseName(course.name));
  const b = EMAIL_BRAND;
  const headline = escapeHtml(buildAlertHeadline(times, eventType));
  const isSingle = times.length === 1;
  const badge =
    eventType === 'reopened' ? 'Reopened' : eventType === 'opened' ? 'New' : 'Matched';
  const matchedLabel = isSingle ? 'Matched tee time' : 'Matched tee times';

  let timesBlock;
  if (isSingle) {
    const t = times[0];
    const time = escapeHtml(formatTime12h(t.rawTime));
    const meta = escapeHtml(slotDetailLine(t) || '—');
    timesBlock = `
      <div style="background:${b.greenSoft};border:1px solid ${b.line};border-radius:18px;padding:18px 20px;margin:8px 0 4px">
        <div style="font-family:${b.fontMono};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${b.pine};margin-bottom:8px">${badge}</div>
        <div style="font-family:${b.fontMono};font-size:28px;font-weight:600;color:${b.ink};line-height:1.15;margin-bottom:8px">${time}</div>
        <div style="font-family:${b.fontMono};font-size:14px;color:${b.muted};letter-spacing:0.01em">${meta}</div>
      </div>`;
  } else {
    const timeRows = times.slice(0, 12).map((t) => {
      const time = escapeHtml(formatTime12h(t.rawTime));
      const price = escapeHtml(t.price || '—');
      const spots =
        t.spots != null ? escapeHtml(`${t.spots} spot${t.spots !== 1 ? 's' : ''}`) : '—';
      const holes = slotHoles(t) ? String(slotHoles(t)) : '—';
      return `<tr>
        <td style="padding:12px 14px;border-bottom:1px solid ${b.line};font-family:${b.fontMono};font-size:15px;color:${b.ink};font-weight:600">${time}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${b.line};font-family:${b.fontMono};font-size:14px;color:${b.muted}">${holes}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${b.line};font-family:${b.fontMono};font-size:14px;color:${b.muted}">${price}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${b.line};font-family:${b.fontMono};font-size:14px;color:${b.muted}">${spots}</td>
      </tr>`;
    }).join('');
    const moreText =
      times.length > 12
        ? `<p style="color:${b.subtle};font-size:13px;margin:12px 0 0">+ ${times.length - 12} more</p>`
        : '';
    timesBlock = `
      <table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 4px;border:1px solid ${b.line};border-radius:18px;overflow:hidden">
        <thead>
          <tr style="background:${b.sand}">
            <th style="padding:10px 14px;text-align:left;font-family:${b.fontMono};font-size:11px;color:${b.subtle};font-weight:600;text-transform:uppercase;letter-spacing:0.14em">Time</th>
            <th style="padding:10px 14px;text-align:left;font-family:${b.fontMono};font-size:11px;color:${b.subtle};font-weight:600;text-transform:uppercase;letter-spacing:0.14em">Holes</th>
            <th style="padding:10px 14px;text-align:left;font-family:${b.fontMono};font-size:11px;color:${b.subtle};font-weight:600;text-transform:uppercase;letter-spacing:0.14em">Price</th>
            <th style="padding:10px 14px;text-align:left;font-family:${b.fontMono};font-size:11px;color:${b.subtle};font-weight:600;text-transform:uppercase;letter-spacing:0.14em">Spots</th>
          </tr>
        </thead>
        <tbody>${timeRows}</tbody>
      </table>
      ${moreText}`;
  }

  const contextBlock =
    renderAlertContextBlock(alertSummary, b) ||
    (alertPrefLine
      ? `<p style="margin:12px 0 6px;color:${b.pine};font-size:13px;font-weight:600;line-height:1.4">${escapeHtml(alertPrefLine)}</p>`
      : '');

  const preheaderSummary = alertSummary?.summaryLine
    ? escapeHtml(alertSummary.summaryLine)
    : escapeHtml(alertPrefLine || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Tee-Time.io Alerts</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Familjen+Grotesk:wght@600;700&family=IBM+Plex+Mono:wght@500;600&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${b.paper};font-family:${b.fontBody}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${headline} at ${courseLabel}${preheaderSummary ? ` · ${preheaderSummary}` : ''}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${b.paper};padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
          <tr>
            <td style="background:${b.pineDeep};border-radius:18px 18px 0 0;padding:22px 24px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="vertical-align:middle;width:40px">
                    <img src="${b.logoUrl}" width="36" height="36" alt="" style="display:block;border-radius:9px">
                  </td>
                  <td style="vertical-align:middle;padding-left:12px">
                    <div style="font-size:18px;font-weight:700;color:#EEF2EC;letter-spacing:-0.035em;font-family:${b.fontDisplay}">
                      Tee-Time<span style="color:${b.fairway}">.io</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:${b.card};border:1px solid ${b.line};border-top:none;border-radius:0 0 18px 18px;padding:24px">
              <div style="font-family:${b.fontMono};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${b.pine};margin-bottom:8px">Alerts</div>
              <h1 style="margin:0 0 8px;font-size:24px;line-height:1.2;color:${b.ink};font-weight:700;letter-spacing:-0.035em;font-family:${b.fontDisplay}">${headline}</h1>
              <h2 style="margin:0;font-size:17px;color:${b.ink};font-weight:600;font-family:${b.fontDisplay}">${courseLabel}</h2>
              ${contextBlock}
              <div style="font-family:${b.fontMono};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${b.subtle};margin:18px 0 0">${matchedLabel}</div>
              ${timesBlock}
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(bookingUrl)}" style="display:inline-block;background:${b.fairway};color:${b.fairwayInk};padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;font-family:${b.fontBody}">Book now</a>
                  </td>
                </tr>
              </table>
              <p style="color:${b.subtle};font-size:12px;text-align:center;line-height:1.55;margin:20px 0 0">
                You set this Alert on
                <a href="${b.siteUrl}" style="color:${b.pine};font-weight:600;text-decoration:none">tee-time.io</a>.
                <a href="${b.accountUrl}" style="color:${b.pine};font-weight:600;text-decoration:none">Manage Alerts</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;text-align:center;font-size:11px;color:${b.subtle};line-height:1.5">
              Tee-Time.io · Every tee time. One search.<br>
              Not affiliated with any booking provider.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** SMS body — short, factual, with Alert context. */
export function buildAlertSmsBody(course, slots, playDate, players, eventType, bookingUrl, alertSummary) {
  const courseLabel = displayCourseName(course.name);
  const dateFormatted = formatPlayDateShort(playDate);
  const verb = verbForEvent(eventType);
  const ctx = alertSummary?.summaryLine ? `${alertSummary.summaryLine}\n` : '';

  if (slots.length === 1) {
    const s = slots[0];
    const holes = holesLabel(slotHoles(s));
    const holesBit = holes ? ` · ${holes}` : '';
    const price = s.price ? ` · ${s.price}` : '';
    return (
      `${ctx}${formatTime12h(s.rawTime)}${holesBit} ${verb} at ${courseLabel} · ${dateFormatted}${price}.\n${bookingUrl}`
    );
  }

  const top = slots
    .slice(0, 5)
    .map((t) => {
      const h = slotHoles(t);
      return `${formatTime12h(t.rawTime)}${h ? ` (${h}h)` : ''}`;
    })
    .join(', ');
  const more = slots.length > 5 ? ` +${slots.length - 5} more` : '';
  return (
    `${ctx}${slots.length} times ${verb} at ${courseLabel} · ${dateFormatted}\n` +
    `${top}${more}\n${bookingUrl}`
  );
}

/** Web push title + body. */
export function buildAlertPushMessage(course, slots, playDate, players, eventType, alertSummary) {
  const courseLabel = displayCourseName(course.name);
  const verb = verbForEvent(eventType);
  const slug = String(course.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  let title;
  if (slots.length === 1) {
    const holes = holesLabel(slotHoles(slots[0]));
    const holesBit = holes ? ` · ${holes}` : '';
    title = `${formatTime12h(slots[0].rawTime)}${holesBit} ${verb}`;
  } else {
    title = `${slots.length} times ${verb}`;
  }

  const dateLabel = formatPlayDateShort(playDate);
  const priceBit = slots.length === 1 && slots[0].price ? ` · ${slots[0].price}` : '';
  const prefBit = alertSummary?.kind === 'weekly' ? ' · Weekly' : alertSummary?.kind === 'one-time' ? ' · One-time' : '';
  const body = `${courseLabel}${prefBit} · ${dateLabel} · ${players} player${players === 1 ? '' : 's'}${priceBit}`;

  return {
    title,
    body,
    url: `https://tee-time.io/app/course/${encodeURIComponent(slug)}?date=${encodeURIComponent(playDate)}`,
    tag: `alert-${slug}-${playDate}`,
  };
}
