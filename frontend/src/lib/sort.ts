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

  const copy = [...courses];
  copy.sort((a, b) => {
    switch (sortBy) {
      case 'soonest':
        return soonest(a.id) - soonest(b.id);
      case 'price':
        return minPrice(a.id) - minPrice(b.id);
      case 'rating':
        return rating(b) - rating(a);
      case 'distance':
      default:
        return distance(a) - distance(b);
    }
  });
  return copy;
}

/** Live-inventory courses with matching times first, then the rest — each group sorted by `sortBy`. */
export function sortFinderGridCourses(
  pool: Course[],
  timesByCourseId: Map<string, TeeTime[]>,
  sortBy: SortBy
): Course[] {
  const withTimes = pool.filter((c) => (timesByCourseId.get(c.id)?.length ?? 0) > 0);
  const without = pool.filter((c) => (timesByCourseId.get(c.id)?.length ?? 0) === 0);
  return [...sortCourses(withTimes, timesByCourseId, sortBy), ...sortCourses(without, timesByCourseId, sortBy)];
}

