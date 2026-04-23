/** Utah catalog — tee sheets and vendor APIs use America/Denver wall time. */
export const UTAH_TEE_TIMEZONE = 'America/Denver';

/**
 * Find the UTC instant where `timeZone` shows y-mo-d hh:mm (wall clock).
 * Linear scan (≈48h × 1 min); fine for client-side transforms.
 */
function wallClockToUtcInstant(y: number, mo: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const read = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
    return { y: get('year'), mo: get('month'), d: get('day'), hh: get('hour'), mm: get('minute') };
  };
  const lo = Date.UTC(y, mo - 1, d - 1, 6, 0, 0);
  const hi = Date.UTC(y, mo - 1, d + 1, 6, 0, 0);
  for (let t = lo; t <= hi; t += 60 * 1000) {
    const g = read(t);
    if (g.y === y && g.mo === mo && g.d === d && g.hh === hh && g.mm === mm) return new Date(t);
  }
  return new Date(Date.UTC(y, mo - 1, d, hh + 7, mm, 0));
}

/**
 * Convert vendor `rawTime` + selected calendar `dateYmd` to a UTC ISO string.
 * - ForeUp: `2026-04-24 16:20` (full local datetime)
 * - Chrono SLC: `07:50` (same-day wall time in Utah)
 * - ISO with Z / offset: pass through as absolute instant
 */
export function rawTeeTimeToIsoUtc(dateYmd: string, rawTime: string, timeZone = UTAH_TEE_TIMEZONE): string {
  const s = rawTime.trim();
  if (!s) return new Date(0).toISOString();

  const looksLikeAbsoluteIso =
    s.includes('T') && (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s) || /[+-]\d{4}$/.test(s));
  if (looksLikeAbsoluteIso) {
    const ms = Date.parse(s);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }

  const full = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (full) {
    const y = Number(full[1]);
    const mo = Number(full[2]);
    const d = Number(full[3]);
    const hh = Number(full[4]);
    const mm = Number(full[5]);
    return wallClockToUtcInstant(y, mo, d, hh, mm, timeZone).toISOString();
  }

  const timeOnly = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (timeOnly) {
    const [ys, ms, ds] = dateYmd.split('-').map(Number);
    if (ys && ms && ds) {
      const hh = Number(timeOnly[1]);
      const mm = Number(timeOnly[2]);
      return wallClockToUtcInstant(ys, ms, ds, hh, mm, timeZone).toISOString();
    }
  }

  const joined = `${dateYmd}T${s.replace(' ', 'T')}`;
  const ms = Date.parse(joined);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();

  return new Date(0).toISOString();
}
