import type { User } from '@supabase/supabase-js';

/** Display name for votes / host label (Google profile or email local-part). */
export function profileDisplayNameFromUser(user: User): string {
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const full = meta?.full_name ?? meta?.name;
  const fromMeta = typeof full === 'string' && full.trim() ? full.trim() : '';
  const fromEmail = user.email?.split('@')[0]?.trim() ?? '';
  const raw = fromMeta || fromEmail || 'You';
  return raw.slice(0, 60);
}
