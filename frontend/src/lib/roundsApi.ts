import type { Course, Plan } from '../types';
import { supabase } from './supabase';
import { formatDateShort, formatTime12h } from './time';

const SLUG_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type DbRound = {
  id: string;
  share_slug: string | null;
  course_id: string | null;
  play_date: string | null;
  title: string;
  organizer_id: string | null;
  created_at: string;
};

export type DbRoundOption = {
  id: string;
  round_id: string;
  course_name: string;
  course_id: string | null;
  date: string;
  time_display: string;
  starts_at: string | null;
  holes: number;
  players: number;
  price: string | null;
  booking_url: string | null;
};

export type DbRoundVote = {
  round_id: string;
  option_id: string;
  voter_key: string;
  status: 'in' | 'maybe' | 'out';
  created_at: string;
  updated_at: string;
};

export type DbRoundVoter = {
  round_id: string;
  voter_key: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

function randomSlug(length = 11): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => SLUG_CHARS[b % 36]).join('');
}

/** Publish all plan options (may span multiple courses). */
export async function publishRoundFromPlan(params: {
  plan: Plan;
  coursesById: Map<string, Course>;
  organizerId: string | null;
}): Promise<{ slug: string; roundId: string } | { error: string }> {
  const { plan, coursesById, organizerId } = params;
  if (plan.options.length === 0) {
    return { error: 'Add at least one tee time from the finder or a course page.' };
  }

  const courseIds = [...new Set(plan.options.map((o) => o.courseId))];
  const names = courseIds.map((id) => coursesById.get(id)?.name ?? id);
  const title =
    courseIds.length > 2
      ? `${names.slice(0, 2).join(' · ')} +${courseIds.length - 2} — ${formatDateShort(plan.date)}`
      : courseIds.length === 2
        ? `${names.join(' · ')} — ${formatDateShort(plan.date)}`
        : `${names[0] ?? 'Round'} — ${formatDateShort(plan.date)}`;

  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = randomSlug(11);
    const { data: roundRow, error: rErr } = await supabase
      .from('rounds')
      .insert({
        share_slug: slug,
        organizer_id: organizerId,
        title,
        course_id: courseIds.length === 1 ? courseIds[0] : null,
        play_date: plan.date,
      })
      .select('id, share_slug')
      .single();

    if (rErr) {
      if (rErr.code === '23505') continue;
      return { error: rErr.message };
    }
    if (!roundRow?.id || !roundRow.share_slug) {
      return { error: 'Could not create round.' };
    }

    const optRows = plan.options.map((o) => {
      const c = coursesById.get(o.courseId);
      return {
        round_id: roundRow.id,
        course_name: c?.catalogName ?? c?.name ?? o.courseId,
        course_id: o.courseId,
        date: plan.date,
        time_display: formatTime12h(o.startsAt),
        starts_at: o.startsAt,
        holes: o.holes,
        players: o.players,
        price: typeof o.price === 'number' ? String(o.price) : null,
        booking_url: o.bookingUrl ?? c?.bookingUrl ?? null,
      };
    });

    const { error: oErr } = await supabase.from('round_options').insert(optRows);
    if (oErr) {
      await supabase.from('rounds').delete().eq('id', roundRow.id);
      return { error: oErr.message };
    }

    return { slug: roundRow.share_slug, roundId: roundRow.id };
  }

  return { error: 'Could not allocate a unique link. Try again.' };
}

export async function fetchRoundBySlug(slug: string): Promise<DbRound | null> {
  const key = slug.trim().toLowerCase();
  if (!key) return null;
  const { data, error } = await supabase.from('rounds').select('*').eq('share_slug', key).maybeSingle();
  if (error || !data) return null;
  return data as DbRound;
}

export async function fetchRoundOptions(roundId: string): Promise<DbRoundOption[]> {
  const { data, error } = await supabase
    .from('round_options')
    .select('*')
    .eq('round_id', roundId)
    .order('starts_at', { ascending: true, nullsFirst: false });
  if (error || !data) return [];
  return data as DbRoundOption[];
}

export async function fetchVotesForRound(roundId: string): Promise<DbRoundVote[]> {
  const { data, error } = await supabase.from('round_option_votes').select('*').eq('round_id', roundId);
  if (error || !data) return [];
  return data as DbRoundVote[];
}

export async function fetchVotersForRound(roundId: string): Promise<DbRoundVoter[]> {
  const { data, error } = await supabase.from('round_voters').select('*').eq('round_id', roundId);
  if (error || !data) return [];
  return data as DbRoundVoter[];
}

export async function upsertVote(params: {
  roundId: string;
  optionId: string;
  voterKey: string;
  status: 'in' | 'maybe' | 'out';
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const { roundId, optionId, voterKey, status } = params;
  const { error } = await supabase.from('round_option_votes').upsert(
    {
      round_id: roundId,
      option_id: optionId,
      voter_key: voterKey,
      status,
    },
    { onConflict: 'option_id,voter_key' },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function upsertVoterName(params: {
  roundId: string;
  voterKey: string;
  displayName: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const name = params.displayName.trim().slice(0, 60);
  if (!name) return { ok: false, message: 'Enter a name.' };
  const { error } = await supabase.from('round_voters').upsert(
    {
      round_id: params.roundId,
      voter_key: params.voterKey,
      display_name: name,
    },
    { onConflict: 'round_id,voter_key' },
  );
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export function aggregateVotes(votes: DbRoundVote[]): Map<string, { in: number; maybe: number; out: number }> {
  const m = new Map<string, { in: number; maybe: number; out: number }>();
  for (const v of votes) {
    const cur = m.get(v.option_id) ?? { in: 0, maybe: 0, out: 0 };
    if (v.status === 'in') cur.in += 1;
    else if (v.status === 'maybe') cur.maybe += 1;
    else if (v.status === 'out') cur.out += 1;
    m.set(v.option_id, cur);
  }
  return m;
}

export function voteForVoter(votes: DbRoundVote[], voterKey: string): Map<string, 'in' | 'maybe' | 'out'> {
  const m = new Map<string, 'in' | 'maybe' | 'out'>();
  for (const v of votes) {
    if (v.voter_key === voterKey) m.set(v.option_id, v.status);
  }
  return m;
}

export function votersByKey(voters: DbRoundVoter[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of voters) {
    m.set(v.voter_key, v.display_name);
  }
  return m;
}
