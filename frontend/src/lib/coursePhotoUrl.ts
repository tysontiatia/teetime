import type { CourseRecord } from './courseRecord';

/** Stored course photo. Page views never call Google for an image. */
export function coursePhotoUrl(record: CourseRecord): string | undefined {
  const storageUrl = record.photo_storage_url?.trim();
  if (storageUrl) return storageUrl;

  const legacy = record.photo_url?.trim();
  if (
    legacy &&
    !/^https:\/\/lh3\.googleusercontent\.com\//i.test(legacy) &&
    !/\/place-photo(?:\?|$)/i.test(legacy)
  ) {
    return legacy;
  }

  return undefined;
}
