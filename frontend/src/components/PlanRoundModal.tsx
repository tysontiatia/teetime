import { useCallback, useEffect, useState } from 'react';
import type { Course, TeeTime } from '../types';
import type { CourseRecord } from '../lib/courseRecord';
import { useAuth } from '../state/AuthContext';
import { publishRoundFromPlan, planFromCourseVisibleTimes } from '../lib/roundsApi';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';
import { formatDateShort, formatTime12h } from '../lib/time';

type PlanRoundModalProps = {
  open: boolean;
  onClose: () => void;
  course: Course;
  record?: CourseRecord;
  dateYmd: string;
  players: 1 | 2 | 3 | 4;
  holes: 9 | 18;
  times: TeeTime[];
  initialSelectedId: string | null;
  coursesById: Map<string, Course>;
  recordsBySlug: Map<string, CourseRecord>;
};

export function PlanRoundModal({
  open,
  onClose,
  course,
  record,
  dateYmd,
  players,
  holes,
  times,
  initialSelectedId,
  coursesById,
  recordsBySlug,
}: PlanRoundModalProps) {
  const { user } = useAuth();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<'idle' | 'ok' | 'fail'>('idle');

  const reset = useCallback(() => {
    const defaultId =
      initialSelectedId && times.some((t) => t.id === initialSelectedId)
        ? initialSelectedId
        : times[0]?.id ?? null;
    setCheckedIds(defaultId ? new Set([defaultId]) : new Set());
    setBusy(false);
    setErr(null);
    setShareSlug(null);
    setCopyHint('idle');
  }, [initialSelectedId, times]);

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const toggleId = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setCheckedIds(new Set(times.map((t) => t.id)));
  const selectOne = () => {
    const id =
      initialSelectedId && times.some((t) => t.id === initialSelectedId)
        ? initialSelectedId
        : times[0]?.id;
    setCheckedIds(id ? new Set([id]) : new Set());
  };

  const onPublish = async () => {
    const uid = user?.id;
    if (!uid || checkedIds.size === 0) return;
    const picked = times.filter((t) => checkedIds.has(t.id));
    if (picked.length === 0) return;

    setBusy(true);
    setErr(null);
    const planPayload = planFromCourseVisibleTimes(course, dateYmd, picked, players, undefined, record);
    const host =
      (user?.user_metadata?.full_name as string | undefined) ||
      (user?.user_metadata?.name as string | undefined) ||
      user?.email?.split('@')[0] ||
      null;
    const res = await publishRoundFromPlan({
      plan: planPayload,
      coursesById,
      organizerId: uid,
      hostPublicName: host,
      recordsBySlug,
    });
    setBusy(false);
    if ('error' in res) {
      setErr(res.error);
      return;
    }
    setShareSlug(res.slug);
    void copyTextToClipboard(absoluteRoundUrl(res.slug)).then((ok) => {
      setCopyHint(ok ? 'ok' : 'fail');
    });
  };

  const onCopy = async () => {
    if (!shareSlug) return;
    const ok = await copyTextToClipboard(absoluteRoundUrl(shareSlug));
    setCopyHint(ok ? 'ok' : 'fail');
    window.setTimeout(() => setCopyHint('idle'), 2200);
  };

  if (!open) return null;

  const shareUrl = shareSlug ? absoluteRoundUrl(shareSlug) : null;
  const pickedCount = checkedIds.size;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-round-title"
      style={{ zIndex: 86 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-panel modal-panel-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="plan-round-title" className="modal-header-title" style={{ fontSize: 20 }}>
              {shareSlug ? 'Vote link ready' : 'Plan a round'}
            </h2>
            <p className="modal-header-sub">
              {shareSlug ? (
                <>Share this link with your group. They can vote on the times you picked.</>
              ) : (
                <>
                  {formatDateShort(dateYmd)} · {players} player{players === 1 ? '' : 's'} · {holes} holes. Choose
                  which tee times to include.
                </>
              )}
            </p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        {shareSlug && shareUrl ? (
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="input" readOnly value={shareUrl} aria-label="Vote link" onFocus={(e) => e.target.select()} />
            <button className="btn btn-primary" type="button" onClick={() => void onCopy()} style={{ padding: '12px 16px' }}>
              {copyHint === 'ok' ? 'Copied!' : copyHint === 'fail' ? 'Copy failed. Select and copy.' : 'Copy link'}
            </button>
            <a
              className="btn btn-ghost"
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              style={{ padding: '10px 16px', textAlign: 'center' }}
            >
              Open vote page →
            </a>
            <button className="btn btn-ghost" type="button" onClick={onClose} style={{ padding: '10px 16px' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="modal-body plan-round-body">
            <div className="plan-round-actions">
              <button type="button" className="plan-round-link-btn" onClick={selectOne}>
                Selected time only
              </button>
              <span aria-hidden>·</span>
              <button type="button" className="plan-round-link-btn" onClick={selectAll}>
                All {times.length} times
              </button>
            </div>

            <ul className="plan-round-times">
              {times.map((t) => {
                const on = checkedIds.has(t.id);
                return (
                  <li key={t.id}>
                    <label className={`plan-round-time${on ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleId(t.id)} />
                      <span className="plan-round-time-main">
                        <span className="plan-round-time-label">{formatTime12h(t.startsAt)}</span>
                        <span className="plan-round-time-meta">
                          {typeof t.price === 'number' ? `$${t.price}` : null}
                          {typeof t.price === 'number' && typeof t.spots === 'number' ? ' · ' : null}
                          {typeof t.spots === 'number' ? `${t.spots} spot${t.spots === 1 ? '' : 's'}` : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {err ? <p className="plan-round-err">{err}</p> : null}

            <button
              className="btn btn-primary"
              type="button"
              disabled={busy || pickedCount === 0}
              onClick={() => void onPublish()}
              style={{ width: '100%', padding: '12px 16px', marginTop: 4 }}
            >
              {busy ? 'Creating link…' : `Create vote link (${pickedCount} time${pickedCount === 1 ? '' : 's'})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
