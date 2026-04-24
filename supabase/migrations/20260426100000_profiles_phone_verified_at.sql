-- Phone verification for SMS alerts (Twilio Verify). Only service_role may set phone_verified_at;
-- authenticated clients changing phone clear verification.

alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

create or replace function public.profiles_phone_verification_enforcement()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.phone_verified_at is distinct from old.phone_verified_at then
    new.phone_verified_at := old.phone_verified_at;
  end if;
  if new.phone is distinct from old.phone then
    new.phone_verified_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tr_profiles_phone_verification on public.profiles;
create trigger tr_profiles_phone_verification
  before update on public.profiles
  for each row execute procedure public.profiles_phone_verification_enforcement();
