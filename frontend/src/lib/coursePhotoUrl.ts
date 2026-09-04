import type { CourseRecord } from './courseRecord';
import { slugFromCourseName } from './courseSlug';
import { getWorkerBaseUrl } from './env';

/** Build a stable photo URL from catalog metadata. */
export function coursePhotoUrl(record: CourseRecord, maxwidth = 800): string | undefined {
  const storageUrl = record.photo_storage_url?.trim();
  if (storageUrl) return storageUrl;

  const ref = record.photo_reference?.trim();
  if (ref) {
    const url = new URL(`${getWorkerBaseUrl()}/place-photo`);
    url.searchParams.set('slug', slugFromCourseName(record.name));
    url.searchParams.set('maxwidth', String(maxwidth));
    return url.toString();
  }

  const legacy = record.photo_url?.trim();
  if (legacy && !/^https:\/\/lh3\.googleusercontent\.com\//i.test(legacy)) {
    return legacy;
  }

  return undefined;
}
