import type { TeeTime } from '../types';

const KEY = 'tt_pending_auth_action';

export type PendingAuthAction = {
  intent: 'book' | 'share';
  courseId: string;
  time: TeeTime | null;
  bookHref: string | null;
};

function isPendingAuthAction(value: unknown): value is PendingAuthAction {
  if (!value || typeof value !== 'object') return false;
  const v = value as PendingAuthAction;
  return (v.intent === 'book' || v.intent === 'share') && typeof v.courseId === 'string';
}

export function savePendingAuthAction(action: PendingAuthAction): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(action));
  } catch {
    // ignore if storage is unavailable
  }
}

export function peekPendingAuthAction(): PendingAuthAction | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPendingAuthAction(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function takePendingAuthAction(): PendingAuthAction | null {
  const pending = peekPendingAuthAction();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  return pending;
}

export function clearPendingAuthAction(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Path `signInWithGoogle` expects: in-app pathname + search (basename `/app`). */
export function authReturnPath(pathname: string, search: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${path}${search}`;
}
