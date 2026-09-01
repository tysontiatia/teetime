/** React Router stamps `idx` on `history.state` for this document’s SPA stack. */
export function canNavigateBack(): boolean {
  if (typeof window === 'undefined') return false;
  const idx = window.history.state?.idx;
  return typeof idx === 'number' && idx > 0;
}
