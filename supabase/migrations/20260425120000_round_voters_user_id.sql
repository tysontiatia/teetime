-- Link voters to accounts (for Shared rounds list + trusted display name on save).

ALTER TABLE public.round_voters
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_round_voters_user_id ON public.round_voters(user_id)
  WHERE user_id IS NOT NULL;

-- Prevent setting someone else’s user_id from the client JWT.
DROP POLICY IF EXISTS "round_voters_insert" ON public.round_voters;
CREATE POLICY "round_voters_insert" ON public.round_voters FOR INSERT
  WITH CHECK (
    user_id IS NULL
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
  );
