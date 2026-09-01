import type { Course, SortBy, TeeTime } from '../types';

export const FINDER_SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'soonest', label: 'Soonest time' },
  { value: 'distance', label: 'Closest' },
  { value: 'price', label: 'Lowest price' },
  { value: 'rating', label: 'Highest rated' },
];

const SORT_BY_VALUES: readonly SortBy[] = FINDER_SORT_OPTIONS.map((o) => o.value);

export function parseSortBy(raw: string | null | undefined): SortBy {
  return SORT_BY_VALUES.includes(raw as SortBy) ? (raw as SortBy) : 'soonest';
}

/** Soonest / price only apply to live openings — empty and book-on-site sit below. */
export function isInventoryFirstSort(sortBy: SortBy): boolean {
  return sortBy === 'soonest' || sortBy === 'price';
}

function soonestMs(timesByCourseId: Map<string, TeeTime[]>, courseId: string): number {
  const times = timesByCourseId.get(courseId) ?? [];
  const min = Math.min(...times.map((t) => new Date(t.startsAt).getTime()));
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

function minPrice(timesByCourseId: Map<string, TeeTime[]>, courseId: string): number {
  const times = timesByCourseId.get(courseId) ?? [];
  const prices = times.map((t) => t.price).filter((p): p is number => typeof p === 'number');
  const min = Math.min(...prices);
  return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
}

function ratingValue(c: Course): number {
  return typeof c.rating === 'number' ? c.rating : -Infinity;
}

function distanceMi(c: Course): number {
  return typeof c.distanceMi === 'number' ? c.distanceMi : Number.POSITIVE_INFINITY;
}

function byName(a: Course, b: Course): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function distanceThenName(a: Course, b: Course): number {
  const primary = distanceMi(a) - distanceMi(b);
  return primary !== 0 ? primary : byName(a, b);
}

export function sortCourses(
  courses: Course[],
  timesByCourseId: Map<string, TeeTime[]>,
  sortBy: SortBy
) {
  const copy = [...courses];
  copy.sort((a, b) => {
    switch (sortBy) {
      case 'soonest': {
        const primary = soonestMs(timesByCourseId, a.id) - soonestMs(timesByCourseId, b.id);
        return primary !== 0 ? primary : distanceThenName(a, b);
      }
      case 'price': {
        const primary = minPrice(timesByCourseId, a.id) - minPrice(timesByCourseId, b.id);
        if (primary !== 0) return primary;
        const byTime = soonestMs(timesByCourseId, a.id) - soonestMs(timesByCourseId, b.id);
        return byTime !== 0 ? byTime : distanceThenName(a, b);
      }
      case 'rating': {
        const primary = ratingValue(b) - ratingValue(a);
        return primary !== 0 ? primary : distanceThenName(a, b);
      }
      case 'distance':
      default:
        return distanceThenName(a, b);
    }
  });
  return copy;
}

/**
 * Finder grid sort.
 * - Distance / rating: true metric order (open, empty, phone, and booking-link mixed).
 * - Soonest / price: courses with matching times first, then the rest — each group sorted by metric.
 */
export function sortFinderGridCourses(
  pool: Course[],
  timesByCourseId: Map<string, TeeTime[]>,
  sortBy: SortBy
): Course[] {
  if (sortBy === 'distance' || sortBy === 'rating') {
    return sortCourses(pool, timesByCourseId, sortBy);
  }

  const withTimes = pool.filter((c) => (timesByCourseId.get(c.id)?.length ?? 0) > 0);
  const without = pool.filter((c) => (timesByCourseId.get(c.id)?.length ?? 0) === 0);
  return [...sortCourses(withTimes, timesByCourseId, sortBy), ...sortCourses(without, timesByCourseId, sortBy)];
}

export function bucketFinderCourses(
  pool: Course[],
  timesByCourseId: Map<string, TeeTime[]>,
  opts: {
    isLive: (course: Course) => boolean;
    isPending: (course: Course) => boolean;
  },
): { openings: Course[]; noTimes: Course[]; alsoNearby: Course[] } {
  const openings: Course[] = [];
  const noTimes: Course[] = [];
  const alsoNearby: Course[] = [];
  for (const c of pool) {
    if (!opts.isLive(c)) {
      alsoNearby.push(c);
      continue;
    }
    const n = timesByCourseId.get(c.id)?.length ?? 0;
    if (n > 0 || opts.isPending(c)) openings.push(c);
    else noTimes.push(c);
  }
  return { openings, noTimes, alsoNearby };
}
