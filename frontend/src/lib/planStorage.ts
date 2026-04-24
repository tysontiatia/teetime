import type { Plan, PlanOption } from '../types';

export const PLAN_STORAGE_KEY = 'teetime.plan.v1';

function isPlayers(n: unknown): n is 1 | 2 | 3 | 4 {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

function isHoles(n: unknown): n is 9 | 18 {
  return n === 9 || n === 18;
}

function parseOption(x: unknown): PlanOption | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.courseId !== 'string' || typeof o.startsAt !== 'string') return null;
  if (!isHoles(o.holes) || !isPlayers(o.players)) return null;
  const opt: PlanOption = {
    id: o.id,
    courseId: o.courseId,
    startsAt: o.startsAt,
    holes: o.holes,
    players: o.players,
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
    const options: PlanOption[] = [];
    for (const item of optionsRaw) {
      const opt = parseOption(item);
      if (opt) options.push(opt);
    }
    const plan: Plan = {
      id: p.id,
      courseId: p.courseId as string | null,
      date: p.date,
      options,
    };
    if (typeof p.title === 'string') plan.title = p.title;
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
