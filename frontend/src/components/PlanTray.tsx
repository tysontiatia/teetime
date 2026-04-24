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
    const lockedId = plan.options[0]!.courseId;
    const name = coursesById.get(lockedId)?.name ?? lockedId;
    const sorted = [...plan.options].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    return {
      name,
      dateLabel: formatDateShort(plan.date),
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
          {summary.name}
        </div>
        <div style={{ fontSize: 12, opacity: 0.72, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span>{summary.dateLabel}</span>
          <span aria-hidden>·</span>
          <span>
            {summary.nTimes} time{summary.nTimes === 1 ? '' : 's'} · {formatTime12h(summary.first.startsAt)}–{formatTime12h(summary.last.startsAt)}
          </span>
        </div>
      </div>

      <Link className="btn btn-primary" to="/plan">
        Create vote link →
      </Link>
      <button
        className="btn btn-ghost"
        onClick={() => {
          clear();
          nav('/');
        }}
        aria-label="Clear list"
        style={{ color: 'rgba(255,255,255,0.75)', borderColor: 'rgba(255,255,255,0.18)' }}
      >
        ✕
      </button>
    </div>
  );
}
