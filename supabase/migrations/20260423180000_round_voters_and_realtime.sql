-- Display names for voters + Realtime publication (enable in Dashboard if add fails)

CREATE TABLE IF NOT EXISTS public.round_voters (
  round_id     uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  voter_key    text NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_round_voters_round_id ON public.round_voters(round_id);

ALTER TABLE public.round_voters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "round_voters_select" ON public.round_voters FOR SELECT USING (true);
CREATE POLICY "round_voters_insert" ON public.round_voters FOR INSERT WITH CHECK (true);
CREATE POLICY "round_voters_update" ON public.round_voters FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_round_voters_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_round_voters_updated ON public.round_voters;
CREATE TRIGGER tr_round_voters_updated
  BEFORE UPDATE ON public.round_voters
  FOR EACH ROW EXECUTE PROCEDURE public.set_round_voters_updated_at();

-- In Supabase Dashboard → Database → Replication, add `round_option_votes` and
-- `round_voters` to the `supabase_realtime` publication for live vote updates.
