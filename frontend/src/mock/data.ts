import type { Course, TeeTime } from '../types';

export const mockCourses: Course[] = [
  {
    id: 'bonneville',
    catalogName: 'Bonneville (SLC)',
    name: 'Bonneville',
    city: 'Salt Lake City',
    lat: 40.7499,
    lng: -111.8395,
    rating: 4.2,
    distanceMi: 3.7,
    bookingUrl: 'https://example.com/book/bonneville',
    photoUrl:
      'https://images.unsplash.com/photo-1527549993586-dff825b37782?w=1200&q=70&auto=format&fit=crop',
  },
  {
    id: 'forest-dale',
    catalogName: 'Forest Dale (SLC)',
    name: 'Forest Dale',
    city: 'Salt Lake City',
    lat: 40.7099,
    lng: -111.8586,
    rating: 4.3,
    distanceMi: 4.3,
    bookingUrl: 'https://example.com/book/forest-dale',
    photoUrl:
      'https://images.unsplash.com/photo-1592919505780-303950717480?w=1200&q=70&auto=format&fit=crop',
  },
  {
    id: 'nibley-park',
    catalogName: 'Nibley Park (SLC)',
    name: 'Nibley Park',
    city: 'Salt Lake City',
    lat: 40.7204,
    lng: -111.8559,
    rating: 3.8,
    distanceMi: 1.1,
    bookingUrl: 'https://example.com/book/nibley-park',
    photoUrl:
      'https://images.unsplash.com/photo-1621873495815-37f2abf1e2f1?w=1200&q=70&auto=format&fit=crop',
  },
  {
    id: 'glendale',
    catalogName: 'Glendale (SLC)',
    name: 'Glendale',
    city: 'Salt Lake City',
    lat: 40.7313,
    lng: -111.9214,
    rating: 4.2,
    distanceMi: 2.6,
    bookingUrl: 'https://example.com/book/glendale',
    photoUrl:
      'https://images.unsplash.com/photo-1527600478564-488952effedb?w=1200&q=70&auto=format&fit=crop',
  },
];

function isoTodayAt(hour: number, minute: number) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const mockTimes: TeeTime[] = [
  // Bonneville
  { id: 'b1', courseId: 'bonneville', startsAt: isoTodayAt(11, 30), price: 44, spots: 4, holes: 18 },
  { id: 'b2', courseId: 'bonneville', startsAt: isoTodayAt(12, 10), price: 44, spots: 2, holes: 18 },
  { id: 'b3', courseId: 'bonneville', startsAt: isoTodayAt(13, 30), price: 38, spots: 4, holes: 18 },
  { id: 'b4', courseId: 'bonneville', startsAt: isoTodayAt(15, 10), price: 38, spots: 1, holes: 18 },

  // Forest Dale
  { id: 'f1', courseId: 'forest-dale', startsAt: isoTodayAt(12, 20), price: 36, spots: 4, holes: 18 },
  { id: 'f2', courseId: 'forest-dale', startsAt: isoTodayAt(13, 20), price: 36, spots: 2, holes: 18 },
  { id: 'f3', courseId: 'forest-dale', startsAt: isoTodayAt(16, 50), price: 28, spots: 4, holes: 9 },

  // Nibley Park
  { id: 'n1', courseId: 'nibley-park', startsAt: isoTodayAt(13, 30), price: 24, spots: 4, holes: 18 },
  { id: 'n2', courseId: 'nibley-park', startsAt: isoTodayAt(13, 50), price: 24, spots: 4, holes: 18 },
  { id: 'n3', courseId: 'nibley-park', startsAt: isoTodayAt(17, 10), price: 18, spots: 2, holes: 9 },

  // Glendale
  { id: 'g1', courseId: 'glendale', startsAt: isoTodayAt(16, 26), price: 42, spots: 4, holes: 18 },
  { id: 'g2', courseId: 'glendale', startsAt: isoTodayAt(18, 6), price: 34, spots: 1, holes: 18 },
];

