import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import type { PlanOption } from '../types';
import { usePlan } from '../state/PlanContext';
import { useAuth } from '../state/AuthContext';
import { publishRoundFromPlan } from '../lib/roundsApi';

function groupPlanOptions(options: PlanOption[], coursesById: Map<string, { name: string; city: string }>) {
  const order: string[] = [];
  const by = new Map<string, PlanOption[]>();
  for (const o of options) {
    if (!by.has(o.courseId)) {
      by.set(o.courseId, []);
      order.push(o.courseId);
    }
    by.get(o.courseId)!.push(o);
  }
  return order.map((cid) => ({
    courseId: cid,
    label: (() => {
      const c = coursesById.get(cid);
      return c ? `${c.name} (${c.city})` : cid;
    })(),
    rows: by.get(cid)!,
  }));
}

export function PlanPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { plan, removeOption, clear } = usePlan();
  const { courses } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const [publishBusy, setPublishBusy] = useState(false);
  const [publishErr, setPublishErr] = useState<string | null>(null);

  const courseIds = useMemo(() => [...new Set(plan.options.map((o) => o.courseId))], [plan.options]);

  const primaryCourseId = courseIds[0] ?? null;
  const planTitle = useMemo(() => {
    if (!primaryCourseId) return '';
    const c = coursesById.get(primaryCourseId);
    return c ? `${c.name} (${c.city})` : primaryCourseId;
  }, [coursesById, primaryCourseId]);

  const sections = useMemo(() => groupPlanOptions(plan.options, coursesById), [plan.options, coursesById]);

  const bookingUrl = useMemo(() => {
    if (!primaryCourseId) return null;
    const fromOption = plan.options.find((o) => o.courseId === primaryCourseId)?.bookingUrl;
    const fromCourse = coursesById.get(primaryCourseId)?.bookingUrl;
    return fromOption ?? fromCourse ?? null;
  }, [coursesById, plan.options, primaryCourseId]);

  const onPublishLiveRound = async () => {
    if (courseIds.length > 1) {
      setPublishErr('Pick times from one course only. Remove extras or start over with Clear.');
      return;
    }
    setPublishBusy(true);
    setPublishErr(null);
    const host =
      (user?.user_metadata?.full_name as string | undefined) ||
      (user?.user_metadata?.name as string | undefined) ||
      user?.email?.split('@')[0] ||
      null;
    const res = await publishRoundFromPlan({
      plan,
      coursesById,
      organizerId: user?.id ?? null,
      hostPublicName: host,
    });
    setPublishBusy(false);
    if ('error' in res) {
      setPublishErr(res.error);
      return;
    }
    nav(`/round/${res.slug}`);
  };

  if (plan.options.length === 0) {
    return (
      <div className="container">
        <div style={{ padding: 18, borderRadius: 18, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.8)' }}>
          <div className="pill">Group vote</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Pick a course, then a few tee times
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Browse the finder, open a course, and tap times you like. Come back here to create <strong>one link</strong> your group opens to vote in or out — no screenshots.
          </p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Browse tee times →
          </Link>
        </div>
      </div>
    );
  }

  const addMoreHref = primaryCourseId ? `/course/${primaryCourseId}` : '/';

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="pill">Group vote</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {planTitle}
          </h2>
          <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">{formatDateShort(plan.date)}</span>
            <span className="pill">
              {plan.options.length} time{plan.options.length === 1 ? '' : 's'} in the poll
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={publishBusy || courseIds.length > 1}
            onClick={() => void onPublishLiveRound()}
            title="Creates the link everyone opens to vote"
          >
            {publishBusy ? 'Creating link…' : 'Create group vote link'}
          </button>
          <Link className="btn btn-ghost" to={addMoreHref}>
            Add more times →
          </Link>
          <button className="btn" type="button" onClick={clear}>
            Clear
          </button>
        </div>
      </div>

      {courseIds.length > 1 ? (
        <p style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid rgba(180,60,60,0.35)', background: 'rgba(254,242,242,0.85)', color: '#7f1d1d', fontSize: 14 }}>
          This list mixes more than one course. Remove times until only one course remains, or tap <strong>Clear</strong>, then build the list again from a single course.
        </p>
      ) : null}

      {publishErr ? (
        <p style={{ marginTop: 10, color: '#9a3412', fontSize: 14 }}>
          {publishErr}
        </p>
      ) : null}

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
        When you create the link, share it in your group chat. Everyone can add a name and vote on each time. Availability can change — double-check before you book.
      </p>

      <div className="plan-split" style={{ marginTop: 14 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', fontWeight: 900 }}>Times in this poll</div>

          <div style={{ padding: 14, display: 'grid', gap: 18 }}>
            {sections.map((sec) => (
              <div key={sec.courseId}>
                {courseIds.length > 1 ? (
                  <div style={{ fontSize: 12, fontWeight: 950, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{sec.label}</div>
                ) : null}
                <div style={{ display: 'grid', gap: 10 }}>
                  {sec.rows.map((option) => (
                    <div
                      key={option.id}
                      style={{
                        border: '1px solid rgba(26,46,26,0.12)',
                        borderRadius: 16,
                        padding: 12,
                        background: '#fff',
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
                        </div>
                      </div>

                      <button className="btn btn-ghost" type="button" onClick={() => removeOption(option.id)} style={{ color: 'var(--muted)' }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
          <div style={{ fontWeight: 900 }}>Booking</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>After the group picks a time, book on the course site.</p>
          {bookingUrl ? (
            <a className="btn btn-primary" href={bookingUrl} target="_blank" rel="noreferrer" style={{ width: '100%', marginTop: 12 }}>
              Open booking site →
            </a>
          ) : (
            <p style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>No booking URL in the catalog for this course.</p>
          )}
        </div>
      </div>
    </div>
  );
}
