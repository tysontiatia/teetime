import type { CourseRecord } from './courseRecord';
import type { CourseRatesExpanded } from './courseCatalogApi';

export type AdminCourseListItem = {
  slug: string;
  name: string;
  area: string | null;
  platform: string | null;
  updated_at: string | null;
  has_rates: boolean;
};

export type AdminCourseDetail = {
  slug: string;
  record: CourseRecord | null;
  registry_updated_at: string | null;
  catalog: Record<string, unknown> | null;
  rates: CourseRatesExpanded | null;
};

export type AdminRatesForm = {
  rate_weekday_walk_9: number | '';
  rate_weekday_walk_18: number | '';
  rate_weekend_walk_9: number | '';
  rate_weekend_walk_18: number | '';
  rate_weekday_cart_9: number | '';
  rate_weekday_cart_18: number | '';
  rate_weekend_cart_9: number | '';
  rate_weekend_cart_18: number | '';
};

export const EMPTY_RATES: AdminRatesForm = {
  rate_weekday_walk_9: '',
  rate_weekday_walk_18: '',
  rate_weekend_walk_9: '',
  rate_weekend_walk_18: '',
  rate_weekday_cart_9: '',
  rate_weekday_cart_18: '',
  rate_weekend_cart_9: '',
  rate_weekend_cart_18: '',
};

export function ratesFromExpanded(r: CourseRatesExpanded | null): AdminRatesForm {
  if (!r) return { ...EMPTY_RATES };
  const pick = (n: number | null) => (n != null ? n : '');
  return {
    rate_weekday_walk_9: pick(r.rate_weekday_walk_9),
    rate_weekday_walk_18: pick(r.rate_weekday_walk_18),
    rate_weekend_walk_9: pick(r.rate_weekend_walk_9),
    rate_weekend_walk_18: pick(r.rate_weekend_walk_18),
    rate_weekday_cart_9: pick(r.rate_weekday_cart_9),
    rate_weekday_cart_18: pick(r.rate_weekday_cart_18),
    rate_weekend_cart_9: pick(r.rate_weekend_cart_9),
    rate_weekend_cart_18: pick(r.rate_weekend_cart_18),
  };
}

export function emptyCourseRecord(name = '', area = ''): CourseRecord {
  return {
    name,
    area,
    platform: '',
    booking_url: '',
  };
}

export function ratesPayload(form: AdminRatesForm): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === '' || v == null) continue;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}
