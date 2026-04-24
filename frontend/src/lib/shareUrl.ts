/** In dev, Vite serves under `BASE_URL`. In production, `/round/slug` or `/round/slug/` is 302’d by `_redirects` to `/app/round/slug/` (trailing slash on the SPA path avoids Pages 308 → `/app/`). */
function roundPathForEnv(slug: string): string {
  const s = slug.trim().toLowerCase();
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '');
  if (import.meta.env.DEV) {
    return `${base}/round/${s}`;
  }
  return `/round/${s}/`;
}

/** Canonical share URL: production uses site root `/round/:slug` (redirects to the SPA). */
export function absoluteRoundUrl(slug: string): string {
  const path = roundPathForEnv(slug);
  if (typeof window === 'undefined') {
    return path;
  }
  return `${window.location.origin}${path}`;
}

/** Legacy hash share (still under BASE_URL). */
export function absoluteShareUrl(encodedHashPayload: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '');
  if (typeof window === 'undefined') {
    return `${base}/share#${encodedHashPayload}`;
  }
  return `${window.location.origin}${base}/share#${encodedHashPayload}`;
}
