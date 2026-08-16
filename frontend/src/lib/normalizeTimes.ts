import type { CourseRecord } from './courseRecord';

type NormRow = { rawTime: string; spots: number | null; price: string | null; holes: number };

function normalizeForeUpTimes(data: unknown, holes: string): NormRow[] {
  if (!Array.isArray(data)) return [];
  const requested = parseInt(holes, 10);
  const fallbackHoles = requested === 9 ? 9 : 18;
  return data
    .map((t) => {
      const row = t as Record<string, unknown>;
      const holesNum = Number(row.holes);
      const rowHoles = holesNum === 9 || holesNum === 18 ? holesNum : fallbackHoles;
      const spotsSide = rowHoles === 9 ? row.available_spots_9 : row.available_spots_18;
      const spotsRaw = spotsSide != null && spotsSide !== '' ? spotsSide : row.available_spots;
      const spots =
        typeof spotsRaw === 'number' && Number.isFinite(spotsRaw)
          ? spotsRaw
          : spotsRaw != null && spotsRaw !== ''
            ? Number(spotsRaw)
            : null;
      return {
        rawTime: String(row.time || ''),
        spots: spots != null && Number.isFinite(spots) ? spots : null,
        price: row.green_fee != null && row.green_fee !== '' ? '$' + parseFloat(String(row.green_fee)).toFixed(0) : null,
        holes: rowHoles,
      };
    })
    .filter((row) => row.spots == null || row.spots > 0)
    .filter((row) => row.holes === fallbackHoles);
}

function normalizeChronogolfTimes(data: { teetimes?: unknown[] }): NormRow[] {
  const items = data?.teetimes;
  if (!Array.isArray(items)) return [];
  return items
    .map((t) => {
      const row = t as Record<string, unknown>;
      const spots = row.max_player_size != null ? Number(row.max_player_size) : null;
      return {
        rawTime: String(row.start_time || ''),
        spots: spots != null && Number.isFinite(spots) ? spots : null,
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
    })
    .filter((row) => row.spots == null || row.spots > 0);
}

function normalizeChronogolfSlcTimes(data: unknown[], holes: string): NormRow[] {
  if (!Array.isArray(data)) return [];
  const nh = parseInt(holes, 10) || 18;
  return data
    .filter((t) => {
      const row = t as Record<string, unknown>;
      if (row.out_of_capacity || row.frozen) return false;
      // No green_fees ⇒ not bookable for our public affiliation (Chronogolf UI hides these).
      const fee = Array.isArray(row.green_fees)
        ? Number((row.green_fees as { green_fee?: number }[])[0]?.green_fee)
        : NaN;
      return Number.isFinite(fee) && fee > 0;
    })
    .map((t) => {
      const row = t as Record<string, unknown>;
      const fee = Number((row.green_fees as { green_fee: number }[])[0]!.green_fee);
      return {
        rawTime: String(row.start_time || ''),
        spots: null,
        price: '$' + Math.round(fee),
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

/** TeeItUp `teetime` is UTC ISO — render in course TZ so rawTeeTimeToIsoUtc reads wall clock. */
function utcIsoToCourseLocal(iso: string, timeZone: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
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
  const tz = String(course.timezone || '').trim() || 'America/Denver';
  const rows: NormRow[] = [];
  for (const entry of data as Record<string, unknown>[]) {
    const teetimes = entry?.teetimes as Record<string, unknown>[] | undefined;
    if (!Array.isArray(teetimes)) continue;
    if (wantHash && entry.courseId && entry.courseId !== wantHash) continue;
    for (const tt of teetimes) {
      const localTime = utcIsoToCourseLocal(String(tt.teetime || ''), tz);
      if (!localTime) continue;
      const spots = tt.maxPlayers != null ? Number(tt.maxPlayers) : null;
      if (spots != null && (!Number.isFinite(spots) || spots <= 0)) continue;
      const rates = (tt.rates as Record<string, unknown>[] | undefined) ?? [];
      for (const rate of rates) {
        const cents = Number(rate.greenFeeCart);
        rows.push({
          rawTime: localTime,
          spots: spots != null && Number.isFinite(spots) ? spots : null,
          price: Number.isFinite(cents) ? '$' + Math.round(cents / 100) : null,
          holes: rate.holes === 9 ? 9 : 18,
        });
      }
    }
  }
  return rows;
}

function truteeAvailableHoles(raw: unknown): Array<9 | 18> {
  return String(raw || '')
    .split('/')
    .map((part) => parseInt(part.trim(), 10))
    .filter((h): h is 9 | 18 => h === 9 || h === 18);
}

/** Trutee fees are cents. Fan out one row per bookable hole option ("9/18" → two rows). */
function normalizeTruteeTimes(course: CourseRecord, data: unknown): NormRow[] {
  if (!data || typeof data !== 'object' || data === null || 'error' in data) return [];
  const teeTimes = (data as { teeTimes?: unknown }).teeTimes;
  if (!Array.isArray(teeTimes)) return [];
  const wantCourse = String(course.trutee_course_id || '').trim();
  const rows: NormRow[] = [];
  for (const entry of teeTimes) {
    const tt = entry as Record<string, unknown>;
    if (wantCourse && tt.course_id && String(tt.course_id) !== wantCourse) continue;
    const spots = tt.available_spots != null ? Number(tt.available_spots) : null;
    if (spots != null && (!Number.isFinite(spots) || spots <= 0)) continue;
    const startDate = String(tt.start_date || '').trim();
    const startTime = String(tt.start_time || '').trim();
    if (!startTime) continue;
    const rawTime = startDate ? `${startDate} ${startTime}` : startTime;
    const holeOptions = truteeAvailableHoles(tt.available_holes);
    if (holeOptions.length === 0) continue;
    for (const holes of holeOptions) {
      const cents = Number(holes === 9 ? tt.green_fee_9 : tt.green_fee_18);
      rows.push({
        rawTime,
        spots: spots != null && Number.isFinite(spots) ? spots : null,
        price: Number.isFinite(cents) ? '$' + Math.round(cents / 100) : null,
        holes,
      });
    }
  }
  return rows;
}

/**
 * GolfPay: skip `is_online_block` placeholders; keep lowest price per wall-clock + holes.
 */
function normalizeGolfPayTimes(data: unknown): NormRow[] {
  if (!data || typeof data !== 'object' || data === null || 'error' in data) return [];
  const times = (data as { data?: { times?: unknown } }).data?.times;
  if (!Array.isArray(times)) return [];
  const best = new Map<string, NormRow & { _priceNum: number }>();
  for (const entry of times) {
    const tt = entry as Record<string, unknown>;
    if (tt.is_online_block) continue;
    const holesRaw = Number(tt.number_of_holes);
    const holes: 9 | 18 | null = holesRaw === 9 ? 9 : holesRaw === 18 ? 18 : null;
    if (!holes) continue;
    const local = String(tt.local_tee_time || '').trim();
    const rawTime = local.replace(/:\d{2}$/, '');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawTime)) continue;
    const priceNum = Number(tt.booking_golfer_price ?? tt.regular_golfer_price);
    if (!Number.isFinite(priceNum) || priceNum <= 1) continue;
    const slot = (tt.provider_data as { tee_time_slot?: { availableSpots?: unknown } } | undefined)
      ?.tee_time_slot;
    const availRaw = slot?.availableSpots;
    const spotsRaw =
      availRaw != null
        ? Number(availRaw)
        : tt.max_allowed_golfers != null
          ? Number(tt.max_allowed_golfers)
          : null;
    const spots = spotsRaw != null && Number.isFinite(spotsRaw) ? spotsRaw : null;
    if (spots != null && spots <= 0) continue;
    const key = `${rawTime}|${holes}`;
    const row = {
      rawTime,
      spots,
      price: '$' + Math.round(priceNum),
      holes,
      _priceNum: priceNum,
    };
    const prev = best.get(key);
    if (!prev || priceNum < prev._priceNum) best.set(key, row);
  }
  return [...best.values()].map((row) => {
    const { _priceNum, ...rest } = row;
    void _priceNum;
    return rest;
  });
}

export function normalizeTimesWorker(course: CourseRecord, data: unknown, holes: string): NormRow[] {
  if (!data || (typeof data === 'object' && data !== null && 'error' in data && (data as { error: unknown }).error))
    return [];
  switch (course.platform) {
    case 'foreup':
      return normalizeForeUpTimes(data, holes);
    case 'membersports':
      return normalizeMemberSportsTimes(data as unknown[], holes);
    case 'chronogolf_slc':
      return normalizeChronogolfSlcTimes(data as unknown[], holes);
    case 'chronogolf':
      return normalizeChronogolfTimes(data as { teetimes?: unknown[] });
    case 'teeitup':
      return normalizeTeeItUpTimes(course, data);
    case 'trutee':
      return normalizeTruteeTimes(course, data);
    case 'golfpay':
      return normalizeGolfPayTimes(data);
    default:
      return [];
  }
}
