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

function uniqueCourseIds(options: PlanOption[]): Set<string> {
  return new Set(options.map((o) => o.courseId));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'plan/reset':
      return { plan: newPlan(action.date) };
    case 'plan/clear':
      return { plan: newPlan(state.plan.date) };
    case 'plan/setCourse': {
      return {
        plan: {
          ...state.plan,
          courseId: action.courseId,
          date: action.date,
          options: state.plan.options,
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

      const dup = state.plan.options.some(
        (o) => o.courseId === option.courseId && o.startsAt === option.startsAt && o.players === option.players,
      );
      if (dup) return state;

      const nextOptions = [...state.plan.options, option].sort(
        (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
      const u = uniqueCourseIds(nextOptions);
      const courseId = u.size === 1 ? [...u][0]! : null;

      return {
        plan: {
          ...state.plan,
          courseId,
          date: state.plan.date,
          options: nextOptions,
        },
      };
    }
    case 'plan/removeOption': {
      const nextOptions = state.plan.options.filter((o) => o.id !== action.optionId);
      const u = uniqueCourseIds(nextOptions);
      const courseId = u.size === 1 ? [...u][0]! : null;
      return { plan: { ...state.plan, options: nextOptions, courseId } };
    }
    default:
      return state;
  }
}

type PlanApi = {
  plan: Plan;
  setCourse: (courseId: string, date: string) => void;
  addOption: (course: Course, teeTime: TeeTime, players: 1 | 2 | 3 | 4) => void;
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
        dispatch({ type: 'plan/addOption', course, teeTime, players });
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
