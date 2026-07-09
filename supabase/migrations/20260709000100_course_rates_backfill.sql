-- One-time backfill: flat course_catalog rate columns -> course_rates (sparse only).
-- Expect 0 rows if flat columns are empty. Idempotent via ON CONFLICT DO NOTHING.

insert into public.course_rates
  (course_slug, day_type, holes, rider_type, resident, season,
   price_cents, price_includes_cart, source, verified_at)
select
  slug, 'weekday', 18, 'walk', null, 'standard',
  rate_weekday_walk * 100, false, 'backfill:course_catalog', rates_updated_at
from public.course_catalog
where rate_weekday_walk is not null
on conflict do nothing;

insert into public.course_rates
  (course_slug, day_type, holes, rider_type, resident, season,
   price_cents, price_includes_cart, source, verified_at)
select
  slug, 'weekend', 18, 'walk', null, 'standard',
  rate_weekend_walk * 100, false, 'backfill:course_catalog', rates_updated_at
from public.course_catalog
where rate_weekend_walk is not null
on conflict do nothing;

insert into public.course_rates
  (course_slug, day_type, holes, rider_type, resident, season,
   price_cents, price_includes_cart, source, verified_at)
select
  slug, 'weekday', 18, 'cart', null, 'standard',
  (rate_weekday_walk + cart_fee) * 100, true, 'backfill:course_catalog', rates_updated_at
from public.course_catalog
where rate_weekday_walk is not null and cart_fee is not null
on conflict do nothing;

insert into public.course_rates
  (course_slug, day_type, holes, rider_type, resident, season,
   price_cents, price_includes_cart, source, verified_at)
select
  slug, 'weekend', 18, 'cart', null, 'standard',
  (rate_weekend_walk + cart_fee) * 100, true, 'backfill:course_catalog', rates_updated_at
from public.course_catalog
where rate_weekend_walk is not null and cart_fee is not null
on conflict do nothing;
