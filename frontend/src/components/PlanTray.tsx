import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Course } from '../types';
import { formatDateShort, formatTime12h } from '../lib/time';
import { usePlan } from '../state/PlanContext';

export function PlanTray({ coursesById }: { coursesById: Map<string, Course> }) {
  const nav = useNavigate();
  const { plan, clear } = usePlan();

  const summary = useMemo(() => {
    if (plan.options.length === 0) return null;
    const ids = [...new Set(plan.options.map((o) => o.courseId))];
    const names = ids.map((id) => coursesById.get(id)?.name ?? id);
    const label =
      names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' · ');
    const sorted = [...plan.options].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    return {
      label,
      dateLabel: formatDateShort(plan.date),
      nCourses: ids.length,
      nTimes: plan.options.length,
      first,
      last,
    };
  }, [coursesById, plan.date, plan.options]);

  if (!summary) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 18,
        zIndex: 50,
        width: 'min(860px, calc(100% - 24px))',
        background: 'rgba(26,46,26,0.96)',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: 22,
        boxShadow: '0 18px 55px rgba(0,0,0,0.28)',
        padding: 12,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        color: '#fff',
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summary.label}
        </div>
        <div style={{ fontSize: 12, opacity: 0.72, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{summary.dateLabel}</span>
          <span aria-hidden>·</span>
          <span>
            {summary.nCourses} course{summary.nCourses === 1 ? '' : 's'}, {summary.nTimes} time{summary.nTimes === 1 ? '' : 's'}
          </span>
          <span aria-hidden>·</span>
          <span>
            {formatTime12h(summary.first.startsAt)}–{formatTime12h(summary.last.startsAt)}
          </span>
        </div>
      </div>

      <Link className="btn btn-primary" to="/plan">
        Review & share →
      </Link>
      <button
        className="btn btn-ghost"
        onClick={() => {
          clear();
          nav('/');
        }}
        aria-label="Clear plan"
        style={{ color: 'rgba(255,255,255,0.75)', borderColor: 'rgba(255,255,255,0.18)' }}
      >
        ✕
      </button>
    </div>
  );
}
