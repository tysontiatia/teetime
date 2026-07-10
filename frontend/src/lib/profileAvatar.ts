import type { User } from '@supabase/supabase-js';

function pickUrl(...candidates: unknown[]): string | undefined {
  for (const v of candidates) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Google / OAuth profile photo from user_metadata or linked identities. */
export function profileAvatarUrlFromUser(user: User | null | undefined): string | undefined {
  if (!user) return undefined;
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const fromMeta = pickUrl(meta?.avatar_url, meta?.picture, meta?.photo_url);
  if (fromMeta) return fromMeta;

  for (const identity of user.identities ?? []) {
    const data = identity.identity_data as Record<string, unknown> | undefined;
    const fromId = pickUrl(data?.avatar_url, data?.picture, data?.photo_url);
    if (fromId) return fromId;
  }
  return undefined;
}
