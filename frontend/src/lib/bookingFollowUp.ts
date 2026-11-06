/** Ignore the flicker of the new tab opening. A real visit is longer than this. */
const MIN_AWAY_MS = 1_000;

export type BookingFollowUpPrompt = {
  courseId: string;
  courseName: string;
};

type Pending = BookingFollowUpPrompt & { leftAt: number | null };

let pending: Pending | null = null;
let prompt: BookingFollowUpPrompt | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function stampLeave(matchId?: string): void {
  if (!pending || pending.leftAt != null) return;
  if (matchId && pending.courseId !== matchId) return;
  pending.leftAt = Date.now();
}

/** Remember the course behind an outbound booking click. A newer click replaces an unanswered one. */
export function noteOutboundBooking(courseId: string, courseName: string): void {
  const id = courseId.trim();
  const name = courseName.trim();
  if (!id || !name) return;
  pending = { courseId: id, courseName: name, leftAt: null };
  prompt = null;
  emit();
  // The course tab often hides this page in the same turn as the click, sometimes just after it.
  // A focus flicker can also clear that leave; keep checking briefly while the page is actually hidden.
  if (typeof window === 'undefined') return;
  let ticks = 0;
  const timer = window.setInterval(() => {
    ticks += 1;
    if (!pending || pending.courseId !== id || pending.leftAt != null || ticks > 8) {
      window.clearInterval(timer);
      return;
    }
    stampLeaveIfHidden(id);
  }, 250);
}

export function onBookingTabHidden(): void {
  stampLeave();
}

function stampLeaveIfHidden(matchId: string): void {
  if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
  stampLeave(matchId);
}

export function onBookingTabVisible(): void {
  if (!pending?.leftAt) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (Date.now() - pending.leftAt < MIN_AWAY_MS) {
    pending.leftAt = null;
    return;
  }
  prompt = { courseId: pending.courseId, courseName: pending.courseName };
  pending = null;
  emit();
}

export function dismissBookingFollowUp(): void {
  if (!prompt) return;
  prompt = null;
  emit();
}

export function subscribeBookingFollowUp(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBookingFollowUp(): BookingFollowUpPrompt | null {
  return prompt;
}
