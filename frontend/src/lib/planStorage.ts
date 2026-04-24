import type { Plan, PlanOption } from '../types';
import { minYmdUtahFromIsoStarts } from './time';

export const PLAN_STORAGE_KEY = 'teetime.plan.v1';

function coercePlayers(n: unknown): 1 | 2 | 3 | 4 | null {
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  const x = typeof n === 'string' ? Number(n) : typeof n === 'number' ? n : NaN;
  if (x === 1 || x === 2 || x === 3 || x === 4) return x;
  return null;
}

function coerceHoles(n: unknown): 9 | 18 | null {
  if (n === 9 || n === 18) return n;
  const x = typeof n === 'string' ? Number(n) : typeof n === 'number' ? n : NaN;
  if (x === 9) return 9;
  if (x === 18) return 18;
  return null;
}

function parseOption(x: unknown, fallbackCourseId: string | null): PlanOption | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const courseId =
    typeof o.courseId === 'string' && o.courseId.length > 0 ? o.courseId : fallbackCourseId;
  if (typeof o.id !== 'string' || !courseId || typeof o.startsAt !== 'string') return null;
  const holes = coerceHoles(o.holes);
  const players = coercePlayers(o.players);
  if (holes == null || players == null) return null;
  const opt: PlanOption = {
    id: o.id,
    courseId,
    startsAt: o.startsAt,
    holes,
    players,
  };
  if (typeof o.price === 'number') opt.price = o.price;
  if (typeof o.spots === 'number') opt.spots = o.spots;
  if (typeof o.bookingUrl === 'string') opt.bookingUrl = o.bookingUrl;
  return opt;
}

export function parseStoredPlan(raw: string | null): Plan | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!data || typeof data !== 'object') return null;
    const p = data as Record<string, unknown>;
    if (typeof p.id !== 'string' || typeof p.date !== 'string') return null;
    if (p.courseId != null && typeof p.courseId !== 'string') return null;
    const optionsRaw = p.options;
    if (!Array.isArray(optionsRaw)) return null;
    const fallbackCourseId = typeof p.courseId === 'string' && p.courseId.length > 0 ? p.courseId : null;
    const options: PlanOption[] = [];
    for (const item of optionsRaw) {
      const opt = parseOption(item, fallbackCourseId);
      if (opt) options.push(opt);
    }
    const plan: Plan = {
      id: p.id,
      courseId: p.courseId as string | null,
      date: p.date,
      options,
    };
    if (typeof p.title === 'string') plan.title = p.title;
    if (plan.options.length > 0) {
      plan.date = minYmdUtahFromIsoStarts(plan.options.map((o) => o.startsAt));
    }
    return plan;
  } catch {
    return null;
  }
}

export function loadPlanFromStorage(fallbackDate: string): Plan {
  if (typeof localStorage === 'undefined') {
    return {
      id: crypto.randomUUID(),
      courseId: null,
      date: fallbackDate,
      options: [],
    };
  }
  const parsed = parseStoredPlan(localStorage.getItem(PLAN_STORAGE_KEY));
  if (!parsed) {
    return {
      id: crypto.randomUUID(),
      courseId: null,
      date: fallbackDate,
      options: [],
    };
  }
  return parsed;
}

export function savePlanToStorage(plan: Plan): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch {
    /* quota / private mode */
  }
}
