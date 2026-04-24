-- Live shared rounds (/round/…): only signed-in users may create rounds and attach options.

DROP POLICY IF EXISTS "rounds_insert" ON public.rounds;
CREATE POLICY "rounds_insert_authenticated_organizer"
  ON public.rounds
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organizer_id IS NOT NULL
    AND organizer_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS "round_options_insert" ON public.round_options;
CREATE POLICY "round_options_insert_own_round"
  ON public.round_options
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.rounds r
      WHERE r.id = round_id
        AND r.organizer_id = (SELECT auth.uid())
    )
  );
