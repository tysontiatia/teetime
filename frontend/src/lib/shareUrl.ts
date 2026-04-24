/** In dev, Vite serves the app under `BASE_URL` only — no root redirect for `/round/`. */
function roundPathForEnv(slug: string): string {
  const s = slug.trim().toLowerCase();
  if (import.meta.env.DEV) {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '');
    return `${base}/round/${s}`;
  }
  return `/round/${s}`;
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
