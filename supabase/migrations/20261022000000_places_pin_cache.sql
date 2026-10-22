-- Remembers a Google Places lookup for a map pin so a repeat state search
-- does not call Places again for 30 days. Written by the worker service role only.

create table if not exists public.places_pin_cache (
  pin_key text primary key,
  nearby jsonb,
  text_place jsonb,
  details jsonb,
  nearby_at timestamptz,
  details_at timestamptz
);

comment on table public.places_pin_cache is
  'Cached Places nearby/details responses keyed by rounded lat,lng. Service role only.';

alter table public.places_pin_cache enable row level security;
