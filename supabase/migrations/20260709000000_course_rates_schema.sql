-- =============================================================================
-- Migration: course_rates normalized rate card + course_catalog seed
-- =============================================================================
-- WRITE-PATH: new rate writes go to course_rates ONLY. Flat course_catalog rate
-- columns are transition/read-compat. No flat<->normalized sync trigger.
-- Identity (address/website/phone) lives in courses.json; prepaid on course_catalog.
-- =============================================================================

create table if not exists public.course_catalog (
  slug                     text primary key,
  name                     text not null,
  holes                    integer check (holes in (9, 18)),
  rate_notes               text,
  twilight_discount        boolean default false,
  walkability              text check (walkability in ('flat','moderate','hilly','carts only')),
  rate_weekday_walk        int,
  rate_weekend_walk        int,
  cart_fee                 int,
  rates_updated_at         timestamptz,
  par                      int,
  yardage                  int,
  booking_window_days      int,
  booking_opens_time       text,
  cancellation_policy      text,
  editorial_note           text,
  signature_hole           text,
  editorial_photo_url      text,
  history_blurb            text,
  booking_url_template     text,
  prepaid                  boolean not null default false,
  last_booking_burst_poll_on date,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

alter table public.course_catalog
  add column if not exists prepaid boolean not null default false;

-- BEFORE APPLY: confirm constraint name in prod (pg_constraint on course_catalog).
alter table public.course_catalog
  drop constraint if exists course_catalog_walkability_check;
alter table public.course_catalog
  add constraint course_catalog_walkability_check
  check (walkability in ('flat','moderate','hilly','carts only'));

insert into public.course_catalog (slug, name) values
  ('barn-golf-club-ogden','Barn Golf Club (Ogden)'),
  ('bear-lake-garden-city','Bear Lake (Garden City)'),
  ('black-desert-resort-ivins','Black Desert Resort (Ivins)'),
  ('bonneville-slc','Bonneville (SLC)'),
  ('bountiful-ridge-bountiful','Bountiful Ridge (Bountiful)'),
  ('canyon-breeze-beaver','Canyon Breeze (Beaver)'),
  ('canyon-hills-nephi','Canyon Hills (Nephi)'),
  ('carbon-cc-helper','Carbon CC (Helper)'),
  ('cedar-hills-cedar-hills','Cedar Hills (Cedar Hills)'),
  ('cedar-ridge-cedar-city','Cedar Ridge (Cedar City)'),
  ('cove-view-richfield','Cove View (Richfield)'),
  ('crane-field-clinton','Crane Field (Clinton)'),
  ('davis-park-kaysville','Davis Park (Kaysville)'),
  ('dinaland-vernal','Dinaland (Vernal)'),
  ('dixie-red-hills-st-george','Dixie Red Hills (St. George)'),
  ('eagle-lake-roy','Eagle Lake (Roy)'),
  ('eagle-mountain-brigham-city','Eagle Mountain (Brigham City)'),
  ('eaglewood-n-salt-lake','Eaglewood (N. Salt Lake)'),
  ('el-monte-ogden','El Monte (Ogden)'),
  ('fore-lakes-taylorsville','Fore Lakes (Taylorsville)'),
  ('forest-dale-slc','Forest Dale (SLC)'),
  ('fox-hollow-american-fork','Fox Hollow (American Fork)'),
  ('gladstan-payson','Gladstan (Payson)'),
  ('glen-eagle-syracuse','Glen Eagle (Syracuse)'),
  ('glendale-slc','Glendale (SLC)'),
  ('green-spring-st-george','Green Spring (St. George)'),
  ('hobble-creek-springville','Hobble Creek (Springville)'),
  ('homestead-midway','Homestead (Midway)'),
  ('lakeside-west-bountiful','Lakeside (West Bountiful)'),
  ('logan-river-logan','Logan River (Logan)'),
  ('meadow-brook-slc','Meadow Brook (SLC)'),
  ('mick-riley-murray','Mick Riley (Murray)'),
  ('mountain-dell-slc','Mountain Dell (SLC)'),
  ('mountain-view-west-jordan','Mountain View (West Jordan)'),
  ('mt-ogden-ogden','Mt. Ogden (Ogden)'),
  ('murray-parkway-murray','Murray Parkway (Murray)'),
  ('nibley-park-slc','Nibley Park (SLC)'),
  ('old-mill-slc','Old Mill (SLC)'),
  ('oquirrh-hills-tooele','Oquirrh Hills (Tooele)'),
  ('park-city-golf-club-park-city','Park City Golf Club (Park City)'),
  ('purple-sage-golf-course-wy','Purple Sage Golf Course (WY)'),
  ('remuda-farr-west','Remuda (Farr West)'),
  ('river-oaks-sandy','River Oaks (Sandy)'),
  ('riverbend-riverton','Riverbend (Riverton)'),
  ('roosevelt-roosevelt','Roosevelt (Roosevelt)'),
  ('rose-park-slc','Rose Park (SLC)'),
  ('sand-hollow-championship-hurricane','Sand Hollow Championship (Hurricane)'),
  ('sand-hollow-links-hurricane','Sand Hollow Links (Hurricane)'),
  ('sky-mountain-hurricane','Sky Mountain (Hurricane)'),
  ('sleepy-ridge-orem','Sleepy Ridge (Orem)'),
  ('south-mountain-draper','South Mountain (Draper)'),
  ('southgate-st-george','Southgate (St. George)'),
  ('st-george-golf-club-st-george','St. George Golf Club (St. George)'),
  ('stonebridge-west-valley-city','Stonebridge (West Valley City)'),
  ('sun-hills-layton','Sun Hills (Layton)'),
  ('sunbrook-st-george','Sunbrook (St. George)'),
  ('sunriver-golf-club-st-george','SunRiver Golf Club (St. George)'),
  ('talonscove-saratoga-springs','TalonsCove (Saratoga Springs)'),
  ('thanksgiving-point-lehi','Thanksgiving Point (Lehi)'),
  ('the-ledges-st-george','The Ledges (St. George)'),
  ('the-oaks-at-spanish-fork-spanish-fork','The Oaks at Spanish Fork (Spanish Fork)'),
  ('the-ranches-eagle-mtn','The Ranches (Eagle Mtn)'),
  ('the-ridge-west-valley','The Ridge (West Valley)'),
  ('timpanogos-championship-provo','Timpanogos Championship (Provo)'),
  ('timpanogos-pasture-provo','Timpanogos Pasture (Provo)'),
  ('valley-view-layton','Valley View (Layton)'),
  ('wolf-creek-eden','Wolf Creek (Eden)')
on conflict (slug) do nothing;

alter table public.course_catalog enable row level security;
drop policy if exists course_catalog_public_read on public.course_catalog;
create policy course_catalog_public_read
  on public.course_catalog for select
  to anon, authenticated
  using (true);

create table if not exists public.course_rates (
  id            uuid primary key default gen_random_uuid(),
  course_slug   text not null references public.course_catalog(slug) on delete cascade,
  day_type      text not null default 'weekday'
                  check (day_type in ('weekday','weekend','holiday')),
  holes         int  not null check (holes in (9, 18)),
  rider_type    text not null default 'walk'
                  check (rider_type in ('walk','cart','twilight')),
  resident      text check (resident is null or resident in ('resident','non_resident')),
  resident_key  text generated always as (coalesce(resident, '')) stored,
  season        text not null default 'standard'
                  check (season = lower(trim(season)) and season <> ''),
  price_cents   int not null check (price_cents >= 0),
  price_includes_cart boolean not null default false,
  rate_notes    text,
  source        text,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists course_rates_cell_uniq
  on public.course_rates (
    course_slug, day_type, holes, rider_type, resident_key, season
  );

create index if not exists course_rates_by_course
  on public.course_rates (course_slug);

create or replace function public.touch_course_rates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists course_rates_touch on public.course_rates;
create trigger course_rates_touch
  before update on public.course_rates
  for each row execute function public.touch_course_rates_updated_at();

alter table public.course_rates enable row level security;
drop policy if exists course_rates_public_read on public.course_rates;
create policy course_rates_public_read
  on public.course_rates for select
  to anon, authenticated
  using (true);

create or replace view public.course_rates_legacy_flat as
with r18 as (
  select course_slug, day_type, rider_type, price_cents
  from public.course_rates
  where holes = 18 and resident is null and season = 'standard'
)
select
  cc.slug as course_slug,
  (max(price_cents) filter (where day_type='weekday' and rider_type='walk')) / 100 as rate_weekday_walk,
  (max(price_cents) filter (where day_type='weekend' and rider_type='walk')) / 100 as rate_weekend_walk,
  coalesce(
    (max(price_cents) filter (where day_type='weekday' and rider_type='cart')
     - max(price_cents) filter (where day_type='weekday' and rider_type='walk')),
    (max(price_cents) filter (where day_type='weekend' and rider_type='cart')
     - max(price_cents) filter (where day_type='weekend' and rider_type='walk'))
  ) / 100 as cart_fee
from public.course_catalog cc
left join r18 on r18.course_slug = cc.slug
group by cc.slug;

comment on view public.course_rates_legacy_flat is
  'READ-ONLY legacy 3-column projection at holes=18, resident null, season=standard.';

create or replace view public.course_rates_expanded as
select
  cc.slug as course_slug,
  max(price_cents) filter (where r.day_type='weekday' and r.holes=9  and r.rider_type='walk') / 100 as rate_weekday_walk_9,
  max(price_cents) filter (where r.day_type='weekday' and r.holes=18 and r.rider_type='walk') / 100 as rate_weekday_walk_18,
  max(price_cents) filter (where r.day_type='weekend' and r.holes=9  and r.rider_type='walk') / 100 as rate_weekend_walk_9,
  max(price_cents) filter (where r.day_type='weekend' and r.holes=18 and r.rider_type='walk') / 100 as rate_weekend_walk_18,
  max(price_cents) filter (where r.day_type='weekday' and r.holes=9  and r.rider_type='cart') / 100 as rate_weekday_cart_9,
  max(price_cents) filter (where r.day_type='weekday' and r.holes=18 and r.rider_type='cart') / 100 as rate_weekday_cart_18,
  max(price_cents) filter (where r.day_type='weekend' and r.holes=9  and r.rider_type='cart') / 100 as rate_weekend_cart_9,
  max(price_cents) filter (where r.day_type='weekend' and r.holes=18 and r.rider_type='cart') / 100 as rate_weekend_cart_18
from public.course_catalog cc
left join public.course_rates r
  on r.course_slug = cc.slug
 and r.resident is null
 and r.season = 'standard'
group by cc.slug;

comment on view public.course_rates_expanded is
  'READ-ONLY UI read model at resident null, season=standard.';
