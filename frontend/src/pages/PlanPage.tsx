import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { formatDateShort, formatTime12h } from '../lib/time';
import type { PlanOption } from '../types';
import { usePlan } from '../state/PlanContext';
import { useAuth } from '../state/AuthContext';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteShareUrl } from '../lib/shareUrl';
import { publishRoundFromPlan } from '../lib/roundsApi';

function bestOptionScore(yes: number, maybe: number, no: number) {
  return yes * 3 + maybe * 1 - no * 2;
}

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

  const [votes, setVotes] = useState<Record<string, { yes: number; maybe: number; no: number }>>({});
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishErr, setPublishErr] = useState<string | null>(null);

  const courseIds = useMemo(() => [...new Set(plan.options.map((o) => o.courseId))], [plan.options]);

  const planSubtitle = useMemo(() => {
    if (courseIds.length === 0) return '';
    const names = courseIds.map((id) => coursesById.get(id)?.name ?? id);
    if (names.length <= 2) return names.join(' · ');
    return `${names.slice(0, 2).join(' · ')} +${names.length - 2} courses`;
  }, [courseIds, coursesById]);

  const shareEncoded = useMemo(() => {
    const payload = {
      v: 2 as const,
      snapshotAt: new Date().toISOString(),
      courseIds,
      courseId: courseIds.length === 1 ? courseIds[0] : null,
      date: plan.date,
      options: plan.options.map((o) => ({
        courseId: o.courseId,
        startsAt: o.startsAt,
        holes: o.holes,
        players: o.players,
        price: o.price,
      })),
    };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  }, [courseIds, plan.date, plan.options]);

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

  const sections = useMemo(() => groupPlanOptions(plan.options, coursesById), [plan.options, coursesById]);

  const bookingPairs = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of plan.options) {
      const c = coursesById.get(o.courseId);
      const url = o.bookingUrl ?? c?.bookingUrl;
      if (url) m.set(o.courseId, url);
    }
    return [...m.entries()];
  }, [plan.options, coursesById]);

  const onCopyShareLink = async () => {
    const ok = await copyTextToClipboard(shareAbsolute);
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  };

  const onPublishLiveRound = async () => {
    setPublishBusy(true);
    setPublishErr(null);
    const res = await publishRoundFromPlan({
      plan,
      coursesById,
      organizerId: user?.id ?? null,
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
          <div className="pill">No active plan</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            Build a shortlist of courses & times
          </h2>
          <p style={{ color: 'var(--muted)' }}>
            Add tee times from <strong>one or more courses</strong> on the finder or course pages, then publish a <strong>live round</strong> link so your group can add their names and vote. Your shortlist is saved on this device until you clear it.
          </p>
          <Link to="/" className="btn btn-primary" style={{ marginTop: 14 }}>
            Go to finder →
          </Link>
        </div>
      </div>
    );
  }

  const addMoreHref = courseIds.length === 1 ? `/course/${courseIds[0]}` : '/';

  return (
    <div className="container">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div className="pill">Plan</div>
          <h2 style={{ margin: '12px 0 6px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {planSubtitle}
          </h2>
          <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">{formatDateShort(plan.date)}</span>
            <span className="pill">
              {courseIds.length} course{courseIds.length === 1 ? '' : 's'} · {plan.options.length} time{plan.options.length === 1 ? '' : 's'}
            </span>
            {best ? (
              <span
                className="pill"
                style={{ background: 'var(--green-soft)', color: 'var(--green-2)', borderColor: 'rgba(45,122,58,0.22)' }}
              >
                Best match highlighted (rehearsal)
              </span>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={publishBusy}
            onClick={() => void onPublishLiveRound()}
            title="Creates a short link with saved votes and names"
          >
            {publishBusy ? 'Publishing…' : 'Publish live round'}
          </button>
          <Link to={shareTo} className="btn">
            Snapshot share page →
          </Link>
          <button className="btn" type="button" onClick={() => void onCopyShareLink()}>
            {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed' : 'Copy snapshot link'}
          </button>
          <button className="btn" type="button" onClick={clear}>
            Clear
          </button>
        </div>
      </div>

      {publishErr ? (
        <p style={{ marginTop: 10, color: '#9a3412', fontSize: 14 }}>
          Could not publish: {publishErr} (Run the latest Supabase migrations if tables are missing.)
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
        <strong style={{ color: 'var(--ink)' }}>Publish live round</strong> gives everyone one link: add a name, vote on each time, updates live.{' '}
        <strong style={{ color: 'var(--ink)' }}>Snapshot</strong> is a frozen hash link for the group chat. Availability can change — re-check before booking.
      </p>

      <div className="plan-split" style={{ marginTop: 14 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.85)', overflow: 'hidden' }}>
          <div style={{ padding: 14, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 900 }}>Candidate times</div>
            <Link className="btn btn-ghost" to={addMoreHref}>
              Add more →
            </Link>
          </div>

          <div style={{ padding: 14, display: 'grid', gap: 18 }}>
            {sections.map((sec) => (
              <div key={sec.courseId}>
                <div style={{ fontSize: 12, fontWeight: 950, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{sec.label}</div>
                <div style={{ display: 'grid', gap: 10 }}>
                  {sec.rows.map((option) => {
                    const row = optionRows.find((r) => r.option.id === option.id);
                    if (!row) return null;
                    const { votes: v, score } = row;
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
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
          <div style={{ fontWeight: 900 }}>Booking</div>
          <p style={{ color: 'var(--muted)', marginTop: 8 }}>Open the right site once your group picks a course and time.</p>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {bookingPairs.map(([cid, url]) => {
              const c = coursesById.get(cid);
              return (
                <a key={cid} className="btn btn-primary" href={url} target="_blank" rel="noreferrer" style={{ width: '100%' }}>
                  {c?.name ?? 'Course'} →
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
