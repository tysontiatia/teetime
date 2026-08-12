/** Finder / detail hole filter. `any` fetches and shows both 9 and 18. */
export type HolesFilter = 9 | 18 | 'any';

export function parseHolesFilter(raw: string | null | undefined): HolesFilter {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'any' || s === 'all') return 'any';
  if (s === '9') return 9;
  return 18;
}

export function holesFilterLabel(holes: HolesFilter): string {
  if (holes === 'any') return 'Any';
  return `${holes}h`;
}

export function holesFilterOptionLabel(holes: HolesFilter): string {
  if (holes === 'any') return 'Any holes';
  return `${holes} holes`;
}
