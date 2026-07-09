-- Admin catalog: course_registry (runtime courses.json mirror) + profiles.is_admin

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'When true, user may call worker /admin/* catalog write APIs.';

-- Full courses.json row per slug; worker + poller read path after backfill.
create table if not exists public.course_registry (
  slug       text primary key references public.course_catalog(slug) on delete cascade,
  record     jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.course_registry is
  'Authoritative runtime course record (courses.json shape). Written via admin API only.';

create or replace function public.touch_course_registry_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists course_registry_touch on public.course_registry;
create trigger course_registry_touch
  before update on public.course_registry
  for each row execute function public.touch_course_registry_updated_at();

alter table public.course_registry enable row level security;

drop policy if exists course_registry_public_read on public.course_registry;
create policy course_registry_public_read
  on public.course_registry for select
  to anon, authenticated
  using (true);
