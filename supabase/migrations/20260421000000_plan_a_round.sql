-- Plan a Round: rounds, options, and RSVPs

CREATE TABLE public.rounds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title         TEXT NOT NULL DEFAULT 'Golf Round',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days')
);

CREATE TABLE public.round_options (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  course_name  TEXT NOT NULL,
  date         TEXT NOT NULL,
  time_display TEXT NOT NULL,
  holes        INTEGER NOT NULL DEFAULT 18,
  players      INTEGER NOT NULL DEFAULT 4,
  price        TEXT,
  booking_url  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.round_rsvps (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         UUID NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  option_id        UUID NOT NULL REFERENCES public.round_options(id) ON DELETE CASCADE,
  participant_name TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('in', 'out')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_round_options_round_id ON public.round_options(round_id);
CREATE INDEX idx_round_rsvps_round_id   ON public.round_rsvps(round_id);
CREATE INDEX idx_round_rsvps_option_id  ON public.round_rsvps(option_id);

-- RLS
ALTER TABLE public.rounds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_rsvps    ENABLE ROW LEVEL SECURITY;

-- rounds: anyone can read (shared via UUID link); anyone can create
CREATE POLICY "rounds_select" ON public.rounds FOR SELECT USING (true);
CREATE POLICY "rounds_insert" ON public.rounds FOR INSERT WITH CHECK (true);

-- round_options: anyone can read; anyone can insert (tied to a round)
CREATE POLICY "round_options_select" ON public.round_options FOR SELECT USING (true);
CREATE POLICY "round_options_insert" ON public.round_options FOR INSERT WITH CHECK (true);

-- round_rsvps: anyone can read and submit
CREATE POLICY "round_rsvps_select" ON public.round_rsvps FOR SELECT USING (true);
CREATE POLICY "round_rsvps_insert" ON public.round_rsvps FOR INSERT WITH CHECK (true);
