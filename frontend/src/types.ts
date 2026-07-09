export type TimeOfDayPreset = 'any' | 'morning' | 'afternoon' | 'evening';

export type SortBy = 'distance' | 'soonest' | 'price' | 'rating';

/** Tee-time fetch scope for the finder (`scope=all` in URL loads statewide). */
export type FetchScope = 'nearby' | 'all';

export type Course = {
  id: string;
  /** Full name from `courses.json` — matches worker + `notification_preferences.course_id`. */
  catalogName: string;
  name: string;
  city: string;
  /** Catalog region label from `courses.json` (e.g. ST. GEORGE AND SOUTHWEST). */
  area?: string;
  lat?: number;
  lng?: number;
  photoUrl?: string;
  rating?: number;
  /** From Google Places metadata in catalog when present. */
  reviewCount?: number;
  distanceMi?: number;
  bookingUrl?: string;
  /** Source platform from catalog (foreup, chronogolf_slc, membersports, …). */
  platform?: string;
  /** Catalog hole count — 9-only courses are excluded from 18-hole finder searches. */
  holes?: 9 | 18;
};

export type WeatherPoint = {
  timeIso: string;
  tempF: number;
  windMph: number;
  precipProb: number; // 0-100
};

export type TeeTime = {
  id: string;
  courseId: string;
  startsAt: string; // ISO
  price?: number;
  spots?: number;
  holes: 9 | 18;
  /** ISO timestamp when poller detected this slot reopened (snapshot path only). */
  reopenedAt?: string;
};

export type SearchParams = {
  locationQuery: string;
  date: string; // YYYY-MM-DD
  players: 1 | 2 | 3 | 4;
  holes: 9 | 18;
  timeOfDay: TimeOfDayPreset;
  sortBy: SortBy;
  fetchScope: FetchScope;
};

export type PlanOption = {
  id: string;
  courseId: string;
  startsAt: string; // ISO
  holes: 9 | 18;
  players: 1 | 2 | 3 | 4;
  price?: number;
  spots?: number;
  bookingUrl?: string;
};

export type Plan = {
  id: string;
  courseId: string | null;
  date: string; // YYYY-MM-DD
  options: PlanOption[];
  title?: string;
};

