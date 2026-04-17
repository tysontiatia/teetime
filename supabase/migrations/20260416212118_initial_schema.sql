-- ─────────────────────────────────────────────────────────────
-- Tee-Time.io — Initial schema
-- ─────────────────────────────────────────────────────────────

-- profiles (auto-created on signup via trigger below)
create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  phone        text,
  notify_via   text not null default 'email'
                 check (notify_via in ('email', 'sms', 'both')),
  created_at   timestamptz not null default now()
);

-- saved_courses
create table public.saved_courses (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles on delete cascade,
  course_id  text not null,
  created_at timestamptz not null default now(),
  unique (user_id, course_id)
);

-- notification_preferences
create table public.notification_preferences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles on delete cascade,
  course_id     text not null,
  days_of_week  int[] not null default '{}',
  earliest_time time not null default '07:00',
  latest_time   time not null default '10:00',
  min_spots     int  not null default 1,
  active        bool not null default true,
  created_at    timestamptz not null default now()
);

-- ── Trigger: auto-create profile row on signup ────────────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── Row Level Security ────────────────────────────────────────
alter table public.profiles                 enable row level security;
alter table public.saved_courses            enable row level security;
alter table public.notification_preferences enable row level security;

create policy "users can manage their own profile"
  on public.profiles for all
  using (auth.uid() = id);

create policy "users can manage their own saved courses"
  on public.saved_courses for all
  using (auth.uid() = user_id);

create policy "users can manage their own notification preferences"
  on public.notification_preferences for all
  using (auth.uid() = user_id);
