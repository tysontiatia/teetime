import type { TeeTime } from '../types';

export function slotActionMeta(time: TeeTime): string {
  return [
    typeof time.price === 'number' ? `$${Math.round(time.price)}` : null,
    typeof time.spots === 'number' ? `${time.spots} spot${time.spots === 1 ? '' : 's'}` : null,
    `${time.holes} holes`,
  ]
    .filter(Boolean)
    .join(' · ');
}
