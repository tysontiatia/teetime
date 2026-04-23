import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import { usePlan } from '../state/PlanContext';

function bestOptionScore(yes: number, maybe: number, no: number) {
  return yes * 3 + maybe * 1 - no * 2;
}

export function PlanPage() {
  const { plan, removeOption, clear } = usePlan();
  const { courses } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const course = plan.courseId ? coursesById.get(plan.courseId) ?? null : null;

  const [votes, setVotes] = useState<Record<string, { yes: number; maybe: number; no: number }>>({});

  const optionRows = useMemo(() => {
    return plan.options.map((o) => {
      const v = votes[o.id] ?? { yes: 0, maybe: 0, no: 0 };
      return {
        option: o,
        votes: v,
        score: bestOptionScore(v.yes, v.maybe, v.no),
      };
    });
  }, [plan.options, votes]);

  const best = useMemo(() => {
    if (!optionRows.length) return null;
    return [...optionRows].sort((a, b) => b.score - a.score)[0];
  }, [optionRows]);

  const shareUrl = useMemo(() => {
    // mock: serialize the plan into the URL so share page can render
    const payload = {
      courseId: plan.courseId,
      date: plan.date,
      options: plan.options.map((o) => ({
        startsAt: o.startsAt,
        holes: o.holes,
        players: o.players,
        price: o.price,
      })),
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    return `/share#${encoded}`;
  }, [plan.courseId, plan.date, plan.options]);

  if (!course || plan.options.length === 0) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
          <div className="pill">No active plan</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Start by adding a few candidate times
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            In v1, plans are <strong>course-first</strong>. Pick one course, add 3–8 candidate tee times, then share a link for your group to vote.
          </p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Go to finder →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="pill">Plan</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {course.name} <span style={{ color: 'var(--muted)', fontWeight: 700 }}>({course.city})</span>
          </h2>
          <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">{formatDateShort(plan.date)}</span>
            <span className="pill">{plan.options.length} option{plan.options.length === 1 ? '' : 's'}</span>
            {best ? <span className="pill" style={{ background: 'var(--green-soft)', color: 'var(--green-2)', borderColor: 'rgba(45,122,58,0.22)' }}>Best match highlighted</span> : null}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to={shareUrl} className="btn btn-primary">
            Share link →
          </Link>
          <button className="btn" type="button" onClick={clear}>
            Clear
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 14 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 900 }}>Candidate times</div>
            <Link className="btn btn-ghost" to={`/course/${course.id}`}>
              Add more →
            </Link>
          </div>

          <div style={{ padding: 14, display: 'grid', gap: 10 }}>
            {optionRows.map(({ option, votes: v, score }) => {
              const isBest = best?.option.id === option.id;
              return (
                <div
                  key={option.id}
                  style={{
                    border: '1px solid rgba(26,46,26,0.12)',
                    borderRadius: 16,
                    padding: 12,
                    background: isBest ? 'rgba(233,245,234,0.85)' : '#fff',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 10,
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 950, letterSpacing: '-0.02em' }}>
                      {formatTime12h(option.startsAt)}{' '}
                      <span style={{ color: 'var(--muted)', fontWeight: 800 }}>
                        · {option.players}p · {option.holes}h{typeof option.price === 'number' ? ` · $${option.price}` : ''}
                      </span>
                      {isBest ? <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 950, color: 'var(--green-2)' }}>Best</span> : null}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setVotes((prev) => ({ ...prev, [option.id]: { ...v, yes: v.yes + 1 } }))}
                        style={{ padding: '8px 10px', borderRadius: 999, background: 'rgba(45,122,58,0.10)', borderColor: 'rgba(45,122,58,0.18)', color: 'var(--green-2)' }}
                      >
                        In ({v.yes})
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setVotes((prev) => ({ ...prev, [option.id]: { ...v, maybe: v.maybe + 1 } }))}
                        style={{ padding: '8px 10px', borderRadius: 999 }}
                      >
                        If needed ({v.maybe})
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setVotes((prev) => ({ ...prev, [option.id]: { ...v, no: v.no + 1 } }))}
                        style={{ padding: '8px 10px', borderRadius: 999, background: 'rgba(234,88,12,0.10)', borderColor: 'rgba(234,88,12,0.18)', color: '#9a3412' }}
                      >
                        Out ({v.no})
                      </button>
                      <span style={{ marginLeft: 2, alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }}>score: {score}</span>
                    </div>
                  </div>

                  <button className="btn btn-ghost" type="button" onClick={() => removeOption(option.id)} style={{ color: 'var(--muted)' }}>
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
          <div style={{ fontWeight: 900 }}>Commit flow (future)</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>
            In production, this page becomes the “decision engine”:
          </p>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--muted)', lineHeight: 1.6 }}>
            <li>auto-highlight best time</li>
            <li>nudge “booker” once consensus forms</li>
            <li>fallback if times disappear</li>
          </ul>

          {course.bookingUrl ? (
            <a className="btn btn-primary" href={course.bookingUrl} target="_blank" rel="noreferrer" style={{ marginTop: 14, width: '100%' }}>
              Open booking site →
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

