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
    default:
      return [];
  }
}
