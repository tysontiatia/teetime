import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Course, TimeOfDayPreset } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';
import { toYmd } from '../lib/time';
import {
  ALERT_DOW_MAP,
  clampAlertPlayers,
  describeAlertDraft,
  dowKeyFromYmd,
  windowToRange,
  type AlertDraftSummary,
  type AlertScheduleValue,
  type AlertTimeWindow,
} from '../lib/alertPrefs';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { formatCityState } from '../lib/courseRecord';
import { getWorkerBaseUrl } from '../lib/env';
import {
  countPushSubscriptions,
  enablePushAlerts,
  pushSupported,
} from '../lib/pushAlerts';
import { SignInPromptModal } from './SignInPromptModal';
import { ModalCloseButton } from './ModalCloseButton';
import { AlertScheduleFields } from './AlertScheduleFields';
import { AlertCourseSearch } from './AlertCourseSearch';
import { captureEvent } from '../lib/analytics';

function todToWindow(tod: TimeOfDayPreset | AlertTimeWindow | undefined): AlertTimeWindow {
  if (tod === 'morning' || tod === 'afternoon' || tod === 'evening' || tod === 'any') return tod;
  return 'any';
}

type AlertMessage = {
  type: 'ok' | 'err' | 'dup';
  text: string;
};

type ExistingPref = {
  id: string;
  active: boolean;
  target_date: string | null;
  days_of_week: number[] | null;
};

function emptySchedule(date: string, players: 1 | 2 | 3 | 4, window: AlertTimeWindow): AlertScheduleValue {
  return {
    mode: 'specific',
    targetDate: date,
    dayOfWeek: dowKeyFromYmd(date),
    timeWindow: window,
    players,
  };
}

export function NotificationModal({
  open,
  onClose,
  course,
  catalog,
  onSaved,
  fromAccount = false,
  defaultDate,
  defaultPlayers,
  defaultTimeOfDay,
}: {
  open: boolean;
  onClose: () => void;
  course: Course | null;
  /** When set and `course` is null, search then schedule in this modal. */
  catalog?: Course[];
  onSaved?: () => void;
  /** Hide “Manage Alerts” — caller is already on the Alerts page. */
  fromAccount?: boolean;
  defaultDate?: string;
  defaultPlayers?: number;
  defaultTimeOfDay?: TimeOfDayPreset | AlertTimeWindow;
}) {
  const { user } = useAuth();
  const todayYmd = toYmd(new Date());
  const [picked, setPicked] = useState<Course | null>(null);
  const [schedule, setSchedule] = useState<AlertScheduleValue>(() =>
    emptySchedule(defaultDate || todayYmd, 2, 'any'),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<AlertMessage | null>(null);
  const [saved, setSaved] = useState<AlertDraftSummary | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const activeCourse = course ?? picked;
  const picking = Boolean(catalog) && !course && !activeCourse && !saved;

  const title = useMemo(() => {
    if (activeCourse) {
      return `${activeCourse.name} (${formatCityState(activeCourse.city, activeCourse.state) || activeCourse.city})`;
    }
    if (catalog) return 'Search a course we track live';
    return 'Course';
  }, [activeCourse, catalog]);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setMessage(null);
      setSaving(false);
      setSaved(null);
      setPushMsg(null);
      return;
    }
    const date = defaultDate && defaultDate >= todayYmd ? defaultDate : todayYmd;
    setSchedule(emptySchedule(date, clampAlertPlayers(defaultPlayers ?? 2), todToWindow(defaultTimeOfDay)));
    setMessage(null);
    setSaved(null);
    setPushMsg(null);
    setPicked(null);
  }, [open, defaultDate, defaultPlayers, defaultTimeOfDay, todayYmd]);

  useBodyScrollLock(open && Boolean(user));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !user?.id || !saved) return;
    let cancelled = false;
    void countPushSubscriptions(user.id).then((n) => {
      if (!cancelled) setPushOn(n > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, saved]);

  if (!open) return null;

  // Keep parent `open` true through Google so the form appears after sign-in.
  if (!user) {
    return (
      <SignInPromptModal
        open
        onClose={onClose}
        variant="alert"
        detail={title}
        closeOnSignIn={false}
      />
    );
  }

  const save = async () => {
    setMessage(null);
    if (!activeCourse) return;

    if (schedule.mode === 'specific' && schedule.targetDate < todayYmd) {
      setMessage({ type: 'err', text: 'Pick today or a future date.' });
      return;
    }

    const { earliest, latest } = windowToRange(schedule.timeWindow);
    const days_of_week = schedule.mode === 'weekly' ? [ALERT_DOW_MAP[schedule.dayOfWeek] ?? 6] : [];

    const { data: existingRows, error: existingErr } = await supabase
      .from('notification_preferences')
      .select('id, active, target_date, days_of_week')
      .eq('user_id', user.id)
      .eq('course_id', activeCourse.catalogName)
      .eq('active', true);

    if (existingErr) {
      setMessage({ type: 'err', text: existingErr.message });
      return;
    }

    const existing = (existingRows ?? []) as ExistingPref[];
    const duplicate = existing.find((row) => {
      if (schedule.mode === 'specific') return row.target_date === schedule.targetDate;
      if (row.target_date) return false;
      const days = row.days_of_week ?? [];
      return days.length === 1 && days[0] === (ALERT_DOW_MAP[schedule.dayOfWeek] ?? 6);
    });

    if (duplicate) {
      setMessage({
        type: 'dup',
        text: fromAccount
          ? 'You already have this Alert. Pause or edit it on this page.'
          : 'You already have this Alert. Pause or edit it in Alerts.',
      });
      return;
    }

    const row = {
      user_id: user.id,
      course_id: activeCourse.catalogName,
      days_of_week,
      earliest_time: earliest,
      latest_time: latest,
      min_spots: schedule.players,
      active: true,
      target_date: schedule.mode === 'specific' ? schedule.targetDate : null,
      players: schedule.players,
      look_ahead_days: schedule.mode === 'weekly' ? 14 : null,
    };

    setSaving(true);
    const { data: inserted, error } = await supabase
      .from('notification_preferences')
      .insert(row)
      .select('id')
      .single();
    setSaving(false);

    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }

    // Fire-and-forget immediate vendor check so matching times can notify without waiting for cron.
    if (inserted?.id) {
      void (async () => {
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          if (!token) return;
          await fetch(`${getWorkerBaseUrl()}/v1/alerts/check`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ preference_id: inserted.id }),
          });
        } catch {
          // Alert is saved; cron micro-poller will pick it up.
        }
      })();
    }

    captureEvent('alert_created', {
      course: activeCourse.name,
      course_id: activeCourse.id,
      mode: schedule.mode,
      players: schedule.players,
      from_account: fromAccount,
    });
    setSaved(describeAlertDraft(schedule));
    onSaved?.();
  };

  const onEnablePush = async () => {
    if (!user.id || pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    const res = await enablePushAlerts(user.id);
    setPushBusy(false);
    if (!res.ok) {
      setPushMsg(res.message);
      return;
    }
    setPushOn(true);
    setPushMsg('Push on — we’ll notify this device.');
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="notif-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="notif-modal-title" className="modal-header-title">
              {saved ? 'Alert saved' : 'Create Alert'}
            </h2>
            <p className="modal-header-sub">{title}</p>
            {!course && catalog && activeCourse && !saved ? (
              <button type="button" className="alert-course-change" onClick={() => setPicked(null)}>
                Change course
              </button>
            ) : null}
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>

        {saved ? (
          <>
            <div className="modal-body">
              <p className="alert-confirm-lede">We’ll email you when times match. Checking now for anything already open.</p>
              <div className="alert-summary">
                <div className="alert-summary-kicker">{saved.title}</div>
                <div className="alert-summary-schedule">{saved.scheduleLine}</div>
                <div className="alert-summary-filters">{saved.filtersLine}</div>
              </div>
              {pushSupported() && !pushOn ? (
                <div className="alert-push-prompt">
                  <div className="alert-push-copy">
                    <div className="alert-push-title">Also notify this device</div>
                    <p className="alert-push-hint">Instant banner when a time opens. Email still goes to {user.email}.</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary alert-push-btn"
                    disabled={pushBusy}
                    onClick={() => void onEnablePush()}
                  >
                    {pushBusy ? '…' : 'Enable push'}
                  </button>
                </div>
              ) : (
                <p className="alert-confirm-email">Email goes to {user.email}{pushOn ? ' · push is on' : ''}.</p>
              )}
              {pushMsg ? <p className="alert-push-msg">{pushMsg}</p> : null}
            </div>
            <div className="modal-footer">
              {fromAccount ? null : (
                <Link to="/account" className="btn" onClick={onClose}>
                  Manage Alerts
                </Link>
              )}
              <button className="btn btn-primary" type="button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : picking ? (
          <>
            <div className="modal-body">
              {catalog ? (
                <AlertCourseSearch courses={catalog} onPick={setPicked} />
              ) : (
                <p className="alert-course-search-hint">No live courses are available to alert on right now.</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <AlertScheduleFields value={schedule} onChange={setSchedule} todayYmd={todayYmd} />
              <p className="alert-email-footnote">Sends to {user.email}</p>

              {message ? (
                <div className={`modal-msg ${message.type === 'dup' ? 'ok' : message.type}`}>
                  <div>{message.text}</div>
                  {message.type === 'dup' && !fromAccount ? (
                    <div className="modal-msg-extra">
                      <Link to="/account" className="detail-text-link" onClick={onClose}>
                        Manage Alerts →
                      </Link>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="modal-footer">
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (!course && catalog) {
                    setPicked(null);
                    setMessage(null);
                    return;
                  }
                  onClose();
                }}
              >
                {!course && catalog ? 'Back' : 'Cancel'}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={saving || !activeCourse}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save Alert'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
