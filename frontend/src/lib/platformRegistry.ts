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
    platform === 'membersports' ||
    platform === 'teeitup'
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
  trutee: 'Trutee',
  teeitup: 'TeeItUp',
};

export function platformDisplayName(platform: string | undefined): string {
  if (!platform) return 'Other';
  return PLATFORM_LABELS[platform] ?? platform.replace(/_/g, ' ');
}

export const ASPIRA_TEEITUP_ALIAS = 'aspira-management-company';

type TeeItUpSource = { teeitup_alias?: string | null; booking_url?: string | null };

/**
 * TeeItUp tenant alias (x-be-alias). Explicit override wins; otherwise the
 * booking URL's subdomain label (…book-v2.teeitup.golf / …book.teeitup.com),
 * defaulting to Aspira.
 */
export function teeItUpAlias(source: TeeItUpSource | null | undefined): string {
  const explicit = source?.teeitup_alias != null ? String(source.teeitup_alias).trim() : '';
  if (explicit) return explicit;
  const m = String(source?.booking_url || '').match(/^https?:\/\/([^.]+)\.book/i);
  return m ? m[1]! : ASPIRA_TEEITUP_ALIAS;
}

/**
 * Caption clarifying which price tier we display. Only the Aspira / Utah State
 * Parks tenant gates residents behind login (we show the non-resident rate);
 * other TeeItUp tenants publish a plain online rate, so no caption.
 */
export function platformPriceCaption(
  source: (TeeItUpSource & { platform?: string | null }) | null | undefined,
): string | null {
  if (source?.platform !== 'teeitup') return null;
  return teeItUpAlias(source) === ASPIRA_TEEITUP_ALIAS ? 'Non-resident rate' : null;
}

export function capabilityHint(cap: PlatformCapability): string {
  switch (cap) {
    case 'live_inventory':
      return 'Live tee times';
    case 'auth_gated_planned':
      return 'Worker support planned. Open site to book';
    default:
      return 'Open site to see times';
  }
}
