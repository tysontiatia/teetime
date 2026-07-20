import type { CourseRecord } from './courseRecord';
import { getWorkerBaseUrl } from './env';

/** Build a stable proxied photo URL from catalog metadata. */
export function coursePhotoUrl(record: CourseRecord, maxwidth = 800): string | undefined {
  const ref = record.photo_reference?.trim();
  if (ref) {
    const url = new URL(`${getWorkerBaseUrl()}/place-photo`);
    url.searchParams.set('reference', ref);
    url.searchParams.set('maxwidth', String(maxwidth));
    return url.toString();
  }

  const legacy = record.photo_url?.trim();
  if (legacy && !/^https:\/\/lh3\.googleusercontent\.com\//i.test(legacy)) {
    return legacy;
  }

  return undefined;
}
