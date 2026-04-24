import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import { usePlan } from '../state/PlanContext';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteShareUrl } from '../lib/shareUrl';

function bestOptionScore(yes: number, maybe: number, no: number) {
  return yes * 3 + maybe * 1 - no * 2;
}

export function PlanPage() {
  const { plan, removeOption, clear } = usePlan();
  const { courses } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const course = plan.courseId ? coursesById.get(plan.courseId) ?? null : null;

  const [votes, setVotes] = useState<Record<string, { yes: number; maybe: number; no: number }>>({});
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');

  const shareEncoded = useMemo(() => {
    const payload = {
      v: 1 as const,
      snapshotAt: new Date().toISOString(),
      courseId: plan.courseId,
      date: plan.date,
      options: plan.options.map((o) => ({
        startsAt: o.startsAt,
        holes: o.holes,
        players: o.players,
        price: o.price,
      })),
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }, [plan.courseId, plan.date, plan.options]);

  const shareTo = `/share#${shareEncoded}`;
  const shareAbsolute = useMemo(() => absoluteShareUrl(shareEncoded), [shareEncoded]);

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

  const onCopyShareLink = async () => {
    const ok = await copyTextToClipboard(shareAbsolute);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  };

  if (!course || plan.options.length === 0) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
          <div className="pill">No active plan</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Start by adding a few candidate times
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            In v1, plans are <strong>course-first</strong>. Pick one course, add 3–8 candidate tee times, then share a link for your group to vote. Your plan is saved on this device until you clear it.
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
        <div style={{ minWidth: 0 }}>
          <div className="pill">Plan</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {course.name} <span style={{ color: 'var(--muted)', fontWeight: 700 }}>({course.city})</span>
          </h2>
          <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">{formatDateShort(plan.date)}</span>
            <span className="pill">
              {plan.options.length} option{plan.options.length === 1 ? '' : 's'}
            </span>
            {best ? (
              <span
                className="pill"
                style={{ background: 'var(--green-soft)', color: 'var(--green-2)', borderColor: 'rgba(45,122,58,0.22)' }}
              >
                Best match highlighted
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link to={shareTo} className="btn btn-primary">
            Open share page →
          </Link>
          <button className="btn" type="button" onClick={() => void onCopyShareLink()}>
            {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy link'}
          </button>
          <button className="btn" type="button" onClick={clear}>
            Clear
          </button>
        </div>
      </div>

      <p
        style={{
          marginTop: 12,
          padding: '12px 14px',
          borderRadius: 14,
          border: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.65)',
          color: 'var(--muted)',
          fontSize: 14,
          lineHeight: 1.5,
          maxWidth: 900,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>Availability can change.</strong> This link encodes your candidate list as a snapshot. Have everyone re-check the tee sheet (or the finder) right before someone books.
      </p>

      <div className="plan-split" style={{ marginTop: 14 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 950, letterSpacing: '-0.02em' }}>
                      {formatTime12h(option.startsAt)}{' '}
                      <span style={{ color: 'var(--muted)', fontWeight: 800 }}>
                        · {option.players}p · {option.holes}h{typeof option.price === 'number' ? ` · $${option.price}` : ''}
                      </span>
                      {isBest ? (
                        <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 950, color: 'var(--green-2)' }}>Best</span>
                      ) : null}
                    </div>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setVotes((prev) => ({ ...prev, [option.id]: { ...v, yes: v.yes + 1 } }))}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 999,
                          background: 'rgba(45,122,58,0.10)',
                          borderColor: 'rgba(45,122,58,0.18)',
                          color: 'var(--green-2)',
                        }}
                      >
                        In ({v.yes})
                      </button>
                      <button className="btn" type="button" onClick={() => setVotes((prev) => ({ ...prev, [option.id]: { ...v, maybe: v.maybe + 1 } }))} style={{ padding: '8px 10px', borderRadius: 999 }}>
                        If needed ({v.maybe})
                      </button>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => setVotes((prev) => ({ ...prev, [option.id]: { ...v, no: v.no + 1 } }))}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 999,
                          background: 'rgba(234,88,12,0.10)',
                          borderColor: 'rgba(234,88,12,0.18)',
                          color: '#9a3412',
                        }}
                      >
                        Out ({v.no})
                      </button>
                      <span style={{ marginLeft: 2, fontSize: 12, color: 'var(--muted)' }}>score: {score}</span>
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
