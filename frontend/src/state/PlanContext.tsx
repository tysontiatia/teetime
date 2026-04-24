import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { Course, Plan, PlanOption, TeeTime } from '../types';
import { loadPlanFromStorage, savePlanToStorage } from '../lib/planStorage';

type State = {
  plan: Plan;
};

type Action =
  | { type: 'plan/reset'; date: string }
  | { type: 'plan/setCourse'; courseId: string; date: string }
  | { type: 'plan/addOption'; course: Course; teeTime: TeeTime; players: 1 | 2 | 3 | 4 }
  | { type: 'plan/removeOption'; optionId: string }
  | { type: 'plan/clear' };

function newPlan(date: string): Plan {
  return {
    id: crypto.randomUUID(),
    courseId: null,
    date,
    options: [],
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'plan/reset':
      return { plan: newPlan(action.date) };
    case 'plan/clear':
      return { plan: newPlan(state.plan.date) };
    case 'plan/setCourse': {
      // if changing courses, clear options
      const shouldClear = state.plan.courseId != null && state.plan.courseId !== action.courseId;
      return {
        plan: {
          ...state.plan,
          courseId: action.courseId,
          date: action.date,
          options: shouldClear ? [] : state.plan.options,
        },
      };
    }
    case 'plan/addOption': {
      const { course, teeTime, players } = action;
      const option: PlanOption = {
        id: crypto.randomUUID(),
        courseId: course.id,
        startsAt: teeTime.startsAt,
        holes: teeTime.holes,
        players,
        price: teeTime.price,
        spots: teeTime.spots,
        bookingUrl: course.bookingUrl,
      };

      // Course-first lock
      const courseId = state.plan.courseId ?? course.id;
      if (courseId !== course.id) return state;

      const dup = state.plan.options.some(
        (o) => o.courseId === option.courseId && o.startsAt === option.startsAt && o.players === option.players
      );
      if (dup) return state;

      return {
        plan: {
          ...state.plan,
          courseId,
          date: state.plan.date,
          options: [...state.plan.options, option].sort(
            (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
          ),
        },
      };
    }
    case 'plan/removeOption':
      return { plan: { ...state.plan, options: state.plan.options.filter((o) => o.id !== action.optionId) } };
    default:
      return state;
  }
}

type PlanApi = {
  plan: Plan;
  setCourse: (courseId: string, date: string) => void;
  addOption: (course: Course, teeTime: TeeTime, players: 1 | 2 | 3 | 4) => { ok: true } | { ok: false; reason: string };
  removeOption: (optionId: string) => void;
  clear: () => void;
};

const PlanContext = createContext<PlanApi | null>(null);

export function PlanProvider({ children, initialDate }: { children: React.ReactNode; initialDate: string }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    plan: loadPlanFromStorage(initialDate),
  }));

  useEffect(() => {
    savePlanToStorage(state.plan);
  }, [state.plan]);

  const api = useMemo<PlanApi>(() => {
    return {
      plan: state.plan,
      setCourse: (courseId, date) => dispatch({ type: 'plan/setCourse', courseId, date }),
      addOption: (course, teeTime, players) => {
        const locked = state.plan.courseId;
        if (locked && locked !== course.id) {
          return { ok: false, reason: 'course_locked' };
        }
        dispatch({ type: 'plan/addOption', course, teeTime, players });
        return { ok: true };
      },
      removeOption: (optionId) => dispatch({ type: 'plan/removeOption', optionId }),
      clear: () => dispatch({ type: 'plan/clear' }),
    };
  }, [state.plan]);

  return <PlanContext.Provider value={api}>{children}</PlanContext.Provider>;
}

export function usePlan() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error('usePlan must be used within PlanProvider');
  return ctx;
}

