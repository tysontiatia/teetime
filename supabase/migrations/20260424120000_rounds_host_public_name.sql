-- Optional display name for "Tyson shared this vote" on the round page (set by client on create).
ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS host_public_name text;
