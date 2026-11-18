import type { CourseRecord } from '../lib/courseRecord';

/**
 * Sheet column          record field
 * Difficulty            difficulty
 * Pace of play          pace_of_play
 * Green speed           green_speed
 * Longest tee (yds)     longest_tee_yards
 * Amenities             amenities
 * Course condition      course_condition   (kept, not shown here)
 * Value                 value_rating       (kept, not shown here)
 * Tees                  tee_sets           (kept, not shown here)
 *
 * A course record wins field by field. The sample below only fills gaps,
 * so it drops out as the Utah sheet is saved onto the catalog.
 */
const SAMPLE_PLAY: Record<string, CoursePlay> = {
  'glendale-slc': {
    difficulty: 'Medium',
    pace_of_play: 'Fast',
    green_speed: 'Medium',
    course_condition: 4.2,
    value_rating: 4.2,
    longest_tee_yards: 6908,
    tee_sets: 4,
    amenities: [
      'Driving Range (Mat)',
      'Putting Green',
      'Motor Cart',
      'Pull Cart',
      'Golf Club Rental',
      'Club Fitting',
      'Pro Shop',
      'Golf Lessons',
      'Restaurant',
      'Changing Room',
    ],
  },
};

type CoursePlay = {
  difficulty?: string;
  pace_of_play?: string;
  green_speed?: string;
  course_condition?: number;
  value_rating?: number;
  longest_tee_yards?: number;
  tee_sets?: number;
  amenities?: string[] | string;
};

export type CourseHighlight = {
  id: 'round' | 'play' | 'site';
  title: string;
  detail: string | null;
};

export function buildCourseHighlights(record: CourseRecord | undefined, slug: string): CourseHighlight[] {
  if (!record) return [];
  const play = mergedPlay(record, slug);
  const rows: CourseHighlight[] = [];
  const round = roundHighlight(record, play);
  const playRow = playHighlight(play);
  const site = siteHighlight(play);
  if (round) rows.push(round);
  if (playRow) rows.push(playRow);
  if (site) rows.push(site);
  return rows;
}

function mergedPlay(record: CourseRecord, slug: string): CoursePlay {
  const sample = SAMPLE_PLAY[slug] ?? {};
  return {
    difficulty: text(record.difficulty) ?? text(sample.difficulty),
    pace_of_play: text(record.pace_of_play) ?? text(sample.pace_of_play),
    green_speed: text(record.green_speed) ?? text(sample.green_speed),
    longest_tee_yards: num(record.longest_tee_yards) ?? num(sample.longest_tee_yards),
    course_condition: num(record.course_condition) ?? num(sample.course_condition),
    value_rating: num(record.value_rating) ?? num(sample.value_rating),
    amenities: amenityList(record.amenities).length > 0 ? record.amenities : sample.amenities,
  };
}

export function courseAboutNotes(record: CourseRecord | undefined, slug: string): { scores: string | null; amenities: string | null } {
  if (!record) return { scores: null, amenities: null };
  const play = mergedPlay(record, slug);
  return {
    scores: golferScores(play.course_condition, play.value_rating),
    amenities: amenityNote(play),
  };
}

function roundHighlight(record: CourseRecord, play: CoursePlay): CourseHighlight | null {
  const holes = record.holes === 9 || record.holes === 18 ? record.holes : null;
  const par = num(record.par);
  const longest = num(play.longest_tee_yards);
  const yards = longest ?? num(record.yardage);
  const title = [
    holes ? `${holes} holes` : null,
    par ? `Par ${par}` : null,
  ].filter(Boolean).join(' · ');
  if (!title && yards == null) return null;
  const detail = yards == null
    ? null
    : `${Math.round(yards).toLocaleString()} yards${longest != null ? ' from the longest tee' : ''}`;
  return { id: 'round', title: title || detail!, detail: title ? detail : null };
}

function playHighlight(play: CoursePlay): CourseHighlight | null {
  const difficulty = word(play.difficulty, ['Easy', 'Medium', 'Hard'], { moderate: 'Medium' });
  const pace = word(play.pace_of_play, ['Slow', 'Medium', 'Fast'], { moderate: 'Medium' });
  const greens = word(play.green_speed, ['Slow', 'Medium', 'Fast'], { moderate: 'Medium' });
  if (!difficulty && !pace && !greens) return null;
  const greenDetail = greens ? `Greens run ${greens.toLowerCase()}` : null;

  if (difficulty && (pace === 'Fast' || pace === 'Slow')) {
    return { id: 'play', title: `${difficulty}, and it plays ${pace.toLowerCase()}`, detail: greenDetail };
  }
  if (difficulty && pace === 'Medium') {
    return {
      id: 'play',
      title: `${difficulty} difficulty`,
      detail: greens ? `Medium pace, and greens run ${greens.toLowerCase()}` : 'Medium pace',
    };
  }
  if (difficulty && greenDetail) return { id: 'play', title: `${difficulty} difficulty`, detail: greenDetail };
  if (pace === 'Fast' || pace === 'Slow') {
    return { id: 'play', title: `Plays ${pace.toLowerCase()}`, detail: greenDetail };
  }
  if (pace === 'Medium') return { id: 'play', title: 'Medium pace', detail: greenDetail };
  if (difficulty) return { id: 'play', title: `${difficulty} difficulty`, detail: null };
  return { id: 'play', title: greenDetail!, detail: null };
}

const SITE_LABEL: Record<string, string> = {
  carts: 'carts',
  pull: 'pull carts',
  rental: 'rental clubs',
  restaurant: 'a restaurant',
  proshop: 'a pro shop',
  lessons: 'lessons',
};

const SUPPORT_ORDER = ['carts', 'pull', 'rental', 'restaurant', 'proshop', 'lessons'] as const;

function siteHighlight(play: CoursePlay): CourseHighlight | null {
  const { found, support } = classifyAmenities(play);
  const range = found.has('range');
  const putting = found.has('putting');
  const title = range && putting
    ? 'Range and a putting green'
    : range
      ? 'Driving range'
      : putting
        ? 'Putting green'
        : null;
  const labels = support.map((key) => SITE_LABEL[key]!);
  if (title) {
    return { id: 'site', title, detail: sentence(labels.slice(0, 3)) };
  }
  if (labels.length === 0) return null;
  return { id: 'site', title: sentence(labels.slice(0, 2))!, detail: sentence(labels.slice(2, 4)) };
}

function classifyAmenities(play: CoursePlay) {
  const names = amenityList(play.amenities);
  const found = new Set<string>();
  for (const name of names) {
    const key = amenityKey(name);
    if (key) found.add(key);
  }
  const support = SUPPORT_ORDER.filter((key) => found.has(key) && !(key === 'pull' && found.has('carts')));
  const featured = found.has('range') || found.has('putting');
  const shown = new Set<string>(featured ? support.slice(0, 3) : support.slice(0, 4));
  if (found.has('range')) shown.add('range');
  if (found.has('putting')) shown.add('putting');
  if (shown.has('carts')) shown.add('pull');
  return { names, found, support, shown };
}

const FACT_LABEL: Record<string, string> = {
  proshop: 'Pro shop',
  lessons: 'Lessons',
  fitting: 'Club fitting',
  locker: 'Changing room',
  pull: 'Pull carts',
  rental: 'Rental clubs',
  restaurant: 'Restaurant',
  carts: 'Carts',
};

function amenityNote(play: CoursePlay): string | null {
  const { names, found, shown } = classifyAmenities(play);
  const range = found.has('range') ? rangeFact(names) : null;
  const more = ['proshop', 'lessons', 'fitting', 'locker', 'pull', 'rental', 'restaurant', 'carts']
    .filter((key) => found.has(key) && !shown.has(key))
    .map((key) => FACT_LABEL[key]!);
  return joinFacts([range, ...more]);
}

function rangeFact(names: string[]): string | null {
  let mats = false;
  let grass = false;
  for (const name of names) {
    const n = name.toLowerCase();
    if (!n.includes('range')) continue;
    if (/\bmat/.test(n)) mats = true;
    if (n.includes('grass')) grass = true;
  }
  if (mats && grass) return 'Mats and grass';
  if (mats) return 'Range mats';
  if (grass) return 'Grass range';
  return null;
}

function golferScores(condition?: number, value?: number): string | null {
  return joinFacts([
    score(condition) ? `Condition ${score(condition)}` : null,
    score(value) ? `Value ${score(value)}` : null,
  ]);
}

function joinFacts(items: (string | null | undefined)[]): string | null {
  const kept = items.filter((item): item is string => Boolean(item));
  return kept.length > 0 ? kept.join(' · ') : null;
}

function score(value?: number): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value.toFixed(1);
}

function amenityKey(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes('driving range') || n.includes('range')) return 'range';
  if (n.includes('putting')) return 'putting';
  if (n.includes('pull cart')) return 'pull';
  if (n.includes('cart')) return 'carts';
  if (n.includes('rental') || n.includes('club rent')) return 'rental';
  if (n.includes('restaurant') || n.includes('grill') || n.includes('snack')) return 'restaurant';
  if (n.includes('pro shop')) return 'proshop';
  if (n.includes('lesson')) return 'lessons';
  if (n.includes('fitting')) return 'fitting';
  if (n.includes('changing room') || n.includes('locker')) return 'locker';
  return null;
}

function amenityList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function sentence(items: string[]): string | null {
  const line = joinList(items);
  if (!line) return null;
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function word(value: string | undefined, allowed: string[], aliases: Record<string, string>): string | null {
  const raw = text(value)?.toLowerCase();
  if (!raw) return null;
  const named = aliases[raw] ?? raw;
  return allowed.find((item) => item.toLowerCase() === named) ?? null;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
