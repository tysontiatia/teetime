type Stat = { label: string; value: string };

type Props = {
  holes?: number | null;
  par?: number | null;
  yardage?: number | null;
};

/** Compact holes / par / yards strip under course identity. */
export function CourseStatsBar({ holes, par, yardage }: Props) {
  const stats: Stat[] = [];
  if (holes === 9 || holes === 18) stats.push({ label: 'Holes', value: String(holes) });
  if (typeof par === 'number' && Number.isFinite(par)) stats.push({ label: 'Par', value: String(par) });
  if (typeof yardage === 'number' && Number.isFinite(yardage)) {
    stats.push({ label: 'Yards', value: yardage.toLocaleString() });
  }
  if (stats.length === 0) return null;

  return (
    <div className="course-stats-bar" role="list" aria-label="Course stats">
      {stats.map((s) => (
        <div key={s.label} className="course-stats-item" role="listitem">
          <span className="course-stats-value">{s.value}</span>
          <span className="course-stats-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
