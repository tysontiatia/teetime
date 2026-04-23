import type { Course } from '../types';

/**
 * Live inventory: worker proxies the vendor API and we normalize tee rows.
 * Add new platforms here and implement the matching route in `worker/index.js`.
 */
export function workerSupportedPlatform(platform: string): boolean {
  return (
    platform === 'foreup' ||
    platform === 'chronogolf' ||
    platform === 'chronogolf_slc' ||
    platform === 'membersports'
  );
}

export function filterWorkerCourses(courses: Course[]): Course[] {
  return courses.filter((c) => c.platform && workerSupportedPlatform(c.platform));
}

export type PlatformCapability = 'live_inventory' | 'booking_link_only' | 'auth_gated_planned';

export function getPlatformCapability(platform: string | undefined): PlatformCapability {
  if (!platform) return 'booking_link_only';
  if (workerSupportedPlatform(platform)) return 'live_inventory';
  if (platform === 'foreup_login') return 'auth_gated_planned';
  return 'booking_link_only';
}

const PLATFORM_LABELS: Record<string, string> = {
  foreup: 'ForeUp',
  foreup_login: 'ForeUp (account)',
  chronogolf: 'Chronogolf',
  chronogolf_slc: 'Chronogolf',
  membersports: 'MemberSports',
  golfpay: 'GolfPay',
  tenfore: 'TenFore',
};

export function platformDisplayName(platform: string | undefined): string {
  if (!platform) return 'Other';
  return PLATFORM_LABELS[platform] ?? platform.replace(/_/g, ' ');
}

export function capabilityHint(cap: PlatformCapability): string {
  switch (cap) {
    case 'live_inventory':
      return 'Live tee times';
    case 'auth_gated_planned':
      return 'Worker support planned — open site to book';
    default:
      return 'Open site to see times';
  }
}
