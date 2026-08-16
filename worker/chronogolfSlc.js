/**
 * Chronogolf club teetimes API is per course_id. Multi-layout clubs (e.g. Mountain
 * Dell Canyon + Lake) store sibling ids in `course_ids` and keep `course_id` as the
 * primary / first layout for admin + booking fallbacks.
 */
export function chronogolfSlcCourseIds(course) {
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const s = v != null ? String(v).trim() : '';
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (Array.isArray(course?.course_ids)) {
    for (const id of course.course_ids) push(id);
  }
  if (out.length) return out;
  push(course?.course_id);
  return out;
}
