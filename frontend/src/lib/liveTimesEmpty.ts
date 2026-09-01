import type { TimeOfDayPreset } from '../types';
import type { HolesFilter } from './holesFilter';

/** Find card badge when a live course has no times matching the current filters. */
export function liveTimesEmptyBadge(timeOfDay: TimeOfDayPreset, holes: HolesFilter): {
  label: string;
} {
  if (timeOfDay === 'morning') return { label: 'Nothing this morning' };
  if (timeOfDay === 'afternoon') return { label: 'Nothing this afternoon' };
  if (timeOfDay === 'evening') return { label: 'No twilight times' };
  if (holes === 9) return { label: 'No 9-hole times' };
  return { label: 'No times today' };
}

/** Finder section under openings when live courses have nothing matching. */
export function liveTimesEmptySection(
  timeOfDay: TimeOfDayPreset,
  holes: HolesFilter,
): { title: string; copy: string } {
  const { label } = liveTimesEmptyBadge(timeOfDay, holes);
  if (timeOfDay !== 'any' || holes === 9) {
    return { title: label, copy: 'Set an alert, or widen the filters.' };
  }
  return { title: label, copy: 'Set an alert, or try another day.' };
}
