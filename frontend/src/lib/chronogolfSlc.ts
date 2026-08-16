/** Chronogolf club teetimes are per course_id; optional `course_ids` fans out siblings. */
export function chronogolfSlcCourseIds(course: {
  course_id?: string | number | null;
  course_ids?: Array<string | number> | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const s = v != null ? String(v).trim() : '';
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };
  if (Array.isArray(course.course_ids)) {
    for (const id of course.course_ids) push(id);
  }
  if (out.length) return out;
  push(course.course_id);
  return out;
}
