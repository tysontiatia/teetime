import type { TimeOfDayPreset } from '../types';
import type { HolesFilter } from './holesFilter';

/** Find card badge when a live course has no times matching the current filters. */
export function liveTimesEmptyBadge(timeOfDay: TimeOfDayPreset, holes: HolesFilter): {
  label: string;
  /** Grey the card only for an all-day miss — a time/holes filter is not a dead course. */
  greyscale: boolean;
} {
  if (timeOfDay === 'morning') return { label: 'Nothing this morning', greyscale: false };
  if (timeOfDay === 'afternoon') return { label: 'Nothing this afternoon', greyscale: false };
  if (timeOfDay === 'evening') return { label: 'No twilight times', greyscale: false };
  if (holes === 9) return { label: 'No 9-hole times', greyscale: false };
  return { label: 'No times today', greyscale: true };
}
