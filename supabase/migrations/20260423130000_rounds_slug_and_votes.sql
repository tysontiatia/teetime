-- Persisted rounds: public slug + machine-readable options + anonymous votes

ALTER TABLE public.rounds
  ADD COLUMN IF NOT EXISTS share_slug text,
  ADD COLUMN IF NOT EXISTS course_id text,
  ADD COLUMN IF NOT EXISTS play_date date;

-- Slugs are stored lowercase from the app; partial unique allows legacy rows without a slug.
CREATE UNIQUE INDEX IF NOT EXISTS rounds_share_slug_unique
  ON public.rounds (share_slug)
  WHERE share_slug IS NOT NULL AND length(trim(share_slug)) > 0;

ALTER TABLE public.round_options
  ADD COLUMN IF NOT EXISTS course_id text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz;

-- One vote per browser key per tee-time option (upsert from client)
CREATE TABLE IF NOT EXISTS public.round_option_votes (
  round_id    uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  option_id   uuid NOT NULL REFERENCES public.round_options(id) ON DELETE CASCADE,
  voter_key   text NOT NULL,
  status      text NOT NULL CHECK (status IN ('in', 'maybe', 'out')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (option_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_round_option_votes_round_id ON public.round_option_votes(round_id);

ALTER TABLE public.round_option_votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "round_option_votes_select"
  ON public.round_option_votes FOR SELECT USING (true);

CREATE POLICY "round_option_votes_insert"
  ON public.round_option_votes FOR INSERT WITH CHECK (true);

CREATE POLICY "round_option_votes_update"
  ON public.round_option_votes FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_round_option_votes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_round_option_votes_updated ON public.round_option_votes;
CREATE TRIGGER tr_round_option_votes_updated
  BEFORE UPDATE ON public.round_option_votes
  FOR EACH ROW EXECUTE PROCEDURE public.set_round_option_votes_updated_at();
