import type { Course, SortBy, TeeTime } from '../types';

export function sortCourses(
  courses: Course[],
  timesByCourseId: Map<string, TeeTime[]>,
  sortBy: SortBy
) {
  const soonest = (courseId: string) => {
    const times = timesByCourseId.get(courseId) ?? [];
    const min = Math.min(...times.map((t) => new Date(t.startsAt).getTime()));
    return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
  };

  const minPrice = (courseId: string) => {
    const times = timesByCourseId.get(courseId) ?? [];
    const prices = times.map((t) => t.price).filter((p): p is number => typeof p === 'number');
    const min = Math.min(...prices);
    return Number.isFinite(min) ? min : Number.POSITIVE_INFINITY;
  };

  const rating = (c: Course) => (typeof c.rating === 'number' ? c.rating : -Infinity);
  const distance = (c: Course) => (typeof c.distanceMi === 'number' ? c.distanceMi : Number.POSITIVE_INFINITY);
  const byName = (a: Course, b: Course) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const copy = [...courses];
  copy.sort((a, b) => {
    let primary = 0;
    switch (sortBy) {
      case 'soonest':
        primary = soonest(a.id) - soonest(b.id);
        break;
      case 'price':
        primary = minPrice(a.id) - minPrice(b.id);
        break;
      case 'rating':
        primary = rating(b) - rating(a);
        break;
      case 'distance':
      default:
        primary = distance(a) - distance(b);
        break;
    }
    return primary !== 0 ? primary : byName(a, b);
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
