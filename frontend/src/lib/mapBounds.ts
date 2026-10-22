export type MapBounds = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export function courseInMapBounds(course: { lat?: number; lng?: number }, bounds: MapBounds): boolean {
  if (typeof course.lat !== 'number' || typeof course.lng !== 'number') return false;
  return (
    course.lat >= bounds.south &&
    course.lat <= bounds.north &&
    course.lng >= bounds.west &&
    course.lng <= bounds.east
  );
}
