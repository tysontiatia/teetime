import { supabase } from './supabase';

/** Row from public.course_rates_expanded (dollars, season=standard, resident null). */
export type CourseRatesExpanded = {
  course_slug: string;
  rate_weekday_walk_9: number | null;
  rate_weekday_walk_18: number | null;
  rate_weekend_walk_9: number | null;
  rate_weekend_walk_18: number | null;
  rate_weekday_cart_9: number | null;
  rate_weekday_cart_18: number | null;
  rate_weekend_cart_9: number | null;
  rate_weekend_cart_18: number | null;
};

export type CourseCatalogMeta = {
  prepaid: boolean;
  cancellation_policy: string | null;
  signature_hole: string | null;
  history_blurb: string | null;
};

export async function fetchCourseRatesExpanded(
  courseSlug: string,
): Promise<CourseRatesExpanded | null> {
  const { data, error } = await supabase
    .from('course_rates_expanded')
    .select(
      'course_slug, rate_weekday_walk_9, rate_weekday_walk_18, rate_weekend_walk_9, rate_weekend_walk_18, rate_weekday_cart_9, rate_weekday_cart_18, rate_weekend_cart_9, rate_weekend_cart_18',
    )
    .eq('course_slug', courseSlug)
    .maybeSingle();

  if (error || !data) return null;
  return data as CourseRatesExpanded;
}

export async function fetchCourseCatalogMeta(courseSlug: string): Promise<CourseCatalogMeta | null> {
  const { data, error } = await supabase
    .from('course_catalog')
    .select('prepaid, cancellation_policy, signature_hole, history_blurb')
    .eq('slug', courseSlug)
    .maybeSingle();

  if (error || !data) return null;
  return {
    prepaid: Boolean(data.prepaid),
    cancellation_policy: data.cancellation_policy ?? null,
    signature_hole: data.signature_hole ?? null,
    history_blurb: data.history_blurb ?? null,
  };
}

export function ratesExpandedHasPrices(rates: CourseRatesExpanded | null): boolean {
  if (!rates) return false;
  return [
    rates.rate_weekday_walk_9,
    rates.rate_weekday_walk_18,
    rates.rate_weekend_walk_9,
    rates.rate_weekend_walk_18,
    rates.rate_weekday_cart_9,
    rates.rate_weekday_cart_18,
    rates.rate_weekend_cart_9,
    rates.rate_weekend_cart_18,
  ].some((v) => v != null);
}

export function formatRateDollars(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n}`;
}
