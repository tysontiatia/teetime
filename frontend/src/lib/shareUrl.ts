/** Deployed under `import.meta.env.BASE_URL` (e.g. `/app/`). */
function appBasePath(): string {
  return (import.meta.env.BASE_URL || '/').replace(/\/?$/, '');
}

export function absoluteShareUrl(encodedHashPayload: string): string {
  const base = appBasePath();
  if (typeof window === 'undefined') {
    return `${base}/share#${encodedHashPayload}`;
  }
  return `${window.location.origin}${base}/share#${encodedHashPayload}`;
}

/** Persisted round at `/round/:slug` (slug is alphanumeric from the app). */
export function absoluteRoundUrl(slug: string): string {
  const base = appBasePath();
  if (typeof window === 'undefined') {
    return `${base}/round/${slug}`;
  }
  return `${window.location.origin}${base}/round/${slug}`;
}
