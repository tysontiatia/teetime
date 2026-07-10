-- Record when user explicitly opted in to transactional SMS alerts (TCPA / toll-free verification).

alter table public.profiles
  add column if not exists sms_consent_at timestamptz;

comment on column public.profiles.sms_consent_at is
  'When the user checked SMS consent on Account (alert channel SMS or Both).';
