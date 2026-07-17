import type { CourseRecord } from './courseRecord';

type NormRow = { rawTime: string; spots: number | null; price: string | null; holes: number };

function normalizeForeUpTimes(data: unknown): NormRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((t) => {
    const row = t as Record<string, unknown>;
    return {
      rawTime: String(row.time || ''),
      spots: (row.available_spots as number) ?? null,
      price: row.green_fee != null ? '$' + parseFloat(String(row.green_fee)).toFixed(0) : null,
      holes: Number(row.holes) || 18,
    };
  });
}

function normalizeChronogolfTimes(data: { teetimes?: unknown[] }): NormRow[] {
  const items = data?.teetimes;
  if (!Array.isArray(items)) return [];
  return items.map((t) => {
    const row = t as Record<string, unknown>;
    return {
      rawTime: String(row.start_time || ''),
      spots: (row.max_player_size as number) ?? null,
      price:
        (row.default_price as { green_fee?: number } | undefined)?.green_fee != null
          ? '$' + parseFloat(String((row.default_price as { green_fee: number }).green_fee)).toFixed(0)
          : null,
      holes:
        Number(
          (row.default_price as { bookable_holes?: number } | undefined)?.bookable_holes ??
            (row.course as { holes?: number } | undefined)?.holes
        ) || 18,
    };
  });
}

function normalizeChronogolfSlcTimes(data: unknown[], holes: string): NormRow[] {
  if (!Array.isArray(data)) return [];
  const nh = parseInt(holes, 10) || 18;
  return data
    .filter((t) => {
      const row = t as Record<string, unknown>;
      return !row.out_of_capacity && !row.frozen;
    })
    .map((t) => {
      const row = t as Record<string, unknown>;
      return {
        rawTime: String(row.start_time || ''),
        spots: null,
        price:
          Array.isArray(row.green_fees) && (row.green_fees as { green_fee?: number }[])[0]?.green_fee != null
            ? '$' + parseFloat(String((row.green_fees as { green_fee: number }[])[0].green_fee)).toFixed(0)
            : null,
        holes: nh,
      };
    });
}

function normalizeMemberSportsTimes(data: unknown[], holes: string): NormRow[] {
  if (!Array.isArray(data)) return [];
  const requestedHoles = parseInt(holes, 10) || 18;
  const result: NormRow[] = [];
  for (const slot of data as Record<string, unknown>[]) {
    const items = slot.items as Record<string, unknown>[] | undefined;
    if (!items?.length) continue;
    for (const item of items) {
      if (item.hide || item.bookingNotAllowed) continue;
      const itemHoles = item.holesRequirementTypeId !== 1 && !item.isBackNine ? 18 : 9;
      if (itemHoles !== requestedHoles) continue;
      const availableSpots = 4 - (Number(item.playerCount) || 0);
      if (availableSpots <= 0) continue;
      const teeTime = Number(slot.teeTime);
      const h = Math.floor(teeTime / 60);
      const m = teeTime % 60;
      const rawTime = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      result.push({
        rawTime,
        spots: availableSpots,
        price: item.price != null ? '$' + parseFloat(String(item.price)).toFixed(0) : null,
        holes: itemHoles,
      });
    }
  }
  return result;
}

/** TeeItUp `teetime` is UTC ISO — render in America/Denver so rawTeeTimeToIsoUtc reads it as wall clock. */
function utcIsoToMtLocal(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hh}:${get('minute')}`;
}

/** Fan out one row per rate (Palisade = 9h + 18h on the same tee time). greenFeeCart is cents (non-resident). */
function normalizeTeeItUpTimes(course: CourseRecord, data: unknown): NormRow[] {
  if (!Array.isArray(data)) return [];
  const wantHash = String(course.teeitup_course_id || '').trim();
  const rows: NormRow[] = [];
  for (const entry of data as Record<string, unknown>[]) {
    const teetimes = entry?.teetimes as Record<string, unknown>[] | undefined;
    if (!Array.isArray(teetimes)) continue;
    if (wantHash && entry.courseId && entry.courseId !== wantHash) continue;
    for (const tt of teetimes) {
      const localTime = utcIsoToMtLocal(String(tt.teetime || ''));
      if (!localTime) continue;
      const spots = tt.maxPlayers != null ? Number(tt.maxPlayers) : null;
      const rates = (tt.rates as Record<string, unknown>[] | undefined) ?? [];
      for (const rate of rates) {
        const cents = Number(rate.greenFeeCart);
        rows.push({
          rawTime: localTime,
          spots,
          price: Number.isFinite(cents) ? '$' + Math.round(cents / 100) : null,
          holes: rate.holes === 9 ? 9 : 18,
        });
      }
    }
  }
  return rows;
}

export function normalizeTimesWorker(course: CourseRecord, data: unknown, holes: string): NormRow[] {
  if (!data || (typeof data === 'object' && data !== null && 'error' in data && (data as { error: unknown }).error))
    return [];
  switch (course.platform) {
    case 'foreup':
      return normalizeForeUpTimes(data);
    case 'membersports':
      return normalizeMemberSportsTimes(data as unknown[], holes);
    case 'chronogolf_slc':
      return normalizeChronogolfSlcTimes(data as unknown[], holes);
    case 'chronogolf':
      return normalizeChronogolfTimes(data as { teetimes?: unknown[] });
    case 'teeitup':
      return normalizeTeeItUpTimes(course, data);
    default:
      return [];
  }
}
