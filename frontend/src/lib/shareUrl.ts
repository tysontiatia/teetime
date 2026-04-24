/** SPA is deployed under `import.meta.env.BASE_URL` (e.g. `/app/`). */
export function absoluteShareUrl(encodedHashPayload: string): string {
  const rawBase = import.meta.env.BASE_URL || '/';
  const base = rawBase.replace(/\/?$/, '');
  if (typeof window === 'undefined') {
    return `${base}/share#${encodedHashPayload}`;
  }
  return `${window.location.origin}${base}/share#${encodedHashPayload}`;
}
