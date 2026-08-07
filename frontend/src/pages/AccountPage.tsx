import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { SMS_ALERTS_ENABLED } from '../lib/smsAlerts';
import { supabase } from '../lib/supabase';
import { toYmd } from '../lib/time';
import {
  ALERT_DOW_MAP,
  ALERT_DOW_SHORT,
  type AlertTimeWindow,
  clampAlertPlayers,
  dowKeyFromIndex,
  rangeToWindow,
  windowLabel,
  windowToRange,
} from '../lib/alertPrefs';
import {
  countPushSubscriptions,
  disablePushAlerts,
  enablePushAlerts,
  pushSupported,
} from '../lib/pushAlerts';

type NotificationPreferenceRow = {
  id: string;
  user_id: string;
  course_id: string;
  days_of_week: number[];
  earliest_time: string;
  latest_time: string;
  min_spots: number;
  active: boolean;
  created_at: string;
  target_date: string | null;
  players: number;
  look_ahead_days: number | null;
};

type EditDraft = {
  mode: 'specific' | 'weekly';
  targetDate: string;
  dayOfWeek: string;
  timeWindow: AlertTimeWindow;
  players: 1 | 2 | 3 | 4;
};

function summarizePref(p: NotificationPreferenceRow): string {
  if (p.target_date) {
    const d = new Date(p.target_date + 'T12:00:00');
    const label = Number.isNaN(d.getTime())
      ? p.target_date
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return `Specific date · ${label}`;
  }
  const days = (p.days_of_week ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((i) => ALERT_DOW_SHORT[i] ?? `?`)
    .join(', ');
  const horizon = p.look_ahead_days != null ? `${p.look_ahead_days}d ahead` : 'open-ended';
  return `Weekly · ${days || '—'} · ${horizon}`;
}

function detailLine(p: NotificationPreferenceRow): string {
  const win = windowLabel(rangeToWindow(p.earliest_time, p.latest_time));
  const players = `${p.players} player${p.players !== 1 ? 's' : ''}`;
  if (p.min_spots !== p.players) return `${win} · ${players} · min ${p.min_spots} spots`;
  return `${win} · ${players}`;
}

function draftFromPref(p: NotificationPreferenceRow, todayYmd: string): EditDraft {
  const isSpecific = Boolean(p.target_date);
  const dow = p.days_of_week?.[0];
  return {
    mode: isSpecific ? 'specific' : 'weekly',
    targetDate: p.target_date && p.target_date >= todayYmd ? p.target_date : todayYmd,
    dayOfWeek: dowKeyFromIndex(typeof dow === 'number' ? dow : 6),
    timeWindow: rangeToWindow(p.earliest_time, p.latest_time),
    players: clampAlertPlayers(p.players),
  };
}

export function AccountPage() {
  const { user, signOut, signInWithGoogle } = useAuth();
  const { courses } = useCourseCatalog();
  const todayYmd = toYmd(new Date());
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPreferenceRow[]>([]);
  const [prefsBusyId, setPrefsBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const canUsePush = pushSupported();

  const loadPrefs = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('notification_preferences')
      .select(
        'id, user_id, course_id, days_of_week, earliest_time, latest_time, min_spots, active, created_at, target_date, players, look_ahead_days',
      )
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (!error && data) setPrefs(data as NotificationPreferenceRow[]);
  }, []);

  const refreshPushState = useCallback(async (uid: string) => {
    const n = await countPushSubscriptions(uid);
    setPushEnabled(n > 0);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      if (!SMS_ALERTS_ENABLED) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('notify_via')
          .eq('id', user.id)
          .single();
        if (prof && (prof.notify_via === 'sms' || prof.notify_via === 'both')) {
          await supabase.from('profiles').update({ notify_via: 'email' }).eq('id', user.id);
        }
      }
      await Promise.all([loadPrefs(user.id), refreshPushState(user.id)]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadPrefs, refreshPushState]);

  const courseNameByCatalog = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courses) m.set(c.catalogName, c.name);
    return m;
  }, [courses]);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMessage({ type, text });
  };

  const startEdit = (p: NotificationPreferenceRow) => {
    setEditingId(p.id);
    setDraft(draftFromPref(p, todayYmd));
    setMessage(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (id: string) => {
    if (!draft) return;
    if (draft.mode === 'specific' && draft.targetDate < todayYmd) {
      flash('err', 'Pick today or a future date.');
      return;
    }

    const { earliest, latest } = windowToRange(draft.timeWindow);
    const patch = {
      earliest_time: earliest,
      latest_time: latest,
      players: draft.players,
      min_spots: draft.players,
      target_date: draft.mode === 'specific' ? draft.targetDate : null,
      days_of_week: draft.mode === 'weekly' ? [ALERT_DOW_MAP[draft.dayOfWeek] ?? 6] : [],
      look_ahead_days: draft.mode === 'weekly' ? 14 : null,
    };

    setPrefsBusyId(id);
    const { error } = await supabase.from('notification_preferences').update(patch).eq('id', id);
    setPrefsBusyId(null);
    if (error) {
      flash('err', error.message);
      return;
    }
    setPrefs((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    cancelEdit();
    flash('ok', 'Alert updated.');
  };

  const setPrefActive = async (id: string, active: boolean) => {
    setPrefsBusyId(id);
    const { error } = await supabase.from('notification_preferences').update({ active }).eq('id', id);
    setPrefsBusyId(null);
    if (error) {
      flash('err', error.message);
      return;
    }
    setPrefs((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)));
    if (editingId === id) cancelEdit();
    flash('ok', active ? 'Alert resumed.' : 'Alert paused.');
  };

  const removePref = async (id: string) => {
    setPrefsBusyId(id);
    const { error } = await supabase.from('notification_preferences').delete().eq('id', id);
    setPrefsBusyId(null);
    if (error) {
      flash('err', error.message);
      return;
    }
    setPrefs((prev) => prev.filter((p) => p.id !== id));
    if (editingId === id) cancelEdit();
    flash('ok', 'Alert removed.');
  };

  const onTogglePush = async () => {
    if (!user?.id || pushBusy) return;
    setPushBusy(true);
    setMessage(null);
    if (pushEnabled) {
      const res = await disablePushAlerts(user.id);
      setPushBusy(false);
      if (!res.ok) {
        flash('err', res.message);
        return;
      }
      setPushEnabled(false);
      flash('ok', 'Push alerts turned off on this device.');
      return;
    }
    const res = await enablePushAlerts(user.id);
    setPushBusy(false);
    if (!res.ok) {
      flash('err', res.message);
      return;
    }
    setPushEnabled(true);
    flash('ok', 'Push alerts on — we’ll notify this device when times open.');
  };

  if (!user) {
    return (
      <div className="container account-page account-page--signed-out">
        <div className="account-page-card">
          <h1 className="account-page-title">Alerts</h1>
          <p className="account-page-signed-out-copy">
            Sign in to get email when tee times open. Google sign-in is free and takes a few seconds.
          </p>
          <div className="account-page-signed-out-actions">
            <button type="button" className="btn btn-primary" onClick={() => void signInWithGoogle()}>
              Continue with Google
            </button>
            <Link to="/" className="btn btn-ghost">
              Back to search
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container account-page">
      <div className="account-page-card">
        <div className="account-page-head">
          <h1 className="account-page-title">Alerts</h1>
          <p className="account-prefs-lede account-page-head-lede">
            We check every few minutes and notify you by email
            {pushEnabled ? ' and push' : ''} when times match.
          </p>
        </div>

        <div className="account-create-bar">
          <Link to="/" className="btn btn-primary account-create-btn">
            Create alert
          </Link>
        </div>

        {loading ? (
          <p className="account-page-status" style={{ marginTop: 18 }}>
            Loading…
          </p>
        ) : (
          <div className="account-page-stack">
            {message ? (
              <div className={`account-msg${message.type === 'ok' ? ' is-ok' : ' is-err'}`}>{message.text}</div>
            ) : null}

            <div className="account-prefs-section">
              {prefs.length === 0 ? (
                <p className="account-prefs-empty">
                  No alerts yet. Tap Create alert, then pick a course on Search.
                </p>
              ) : (
                <ul className="account-pref-list">
                  {prefs.map((p) => {
                    const title = courseNameByCatalog.get(p.course_id) ?? p.course_id;
                    const busy = prefsBusyId === p.id;
                    const editing = editingId === p.id && draft;
                    return (
                      <li key={p.id} className={`account-pref-item${p.active ? '' : ' is-paused'}`}>
                        <div className="account-pref-head">
                          <div className="account-pref-title">{title}</div>
                          {!p.active ? <span className="account-pref-badge">Paused</span> : null}
                        </div>

                        {editing ? (
                          <div className="account-pref-edit">
                            <div className="modal-seg account-pref-seg">
                              <button
                                type="button"
                                className={`btn modal-seg-btn${draft.mode === 'specific' ? ' on' : ''}`}
                                onClick={() => setDraft({ ...draft, mode: 'specific' })}
                              >
                                Specific date
                              </button>
                              <button
                                type="button"
                                className={`btn modal-seg-btn${draft.mode === 'weekly' ? ' on' : ''}`}
                                onClick={() => setDraft({ ...draft, mode: 'weekly' })}
                              >
                                Weekly
                              </button>
                            </div>

                            <div className="account-pref-edit-grid">
                              {draft.mode === 'specific' ? (
                                <div>
                                  <label className="modal-label">Date</label>
                                  <input
                                    className="input"
                                    type="date"
                                    min={todayYmd}
                                    value={draft.targetDate}
                                    onChange={(e) => setDraft({ ...draft, targetDate: e.target.value })}
                                  />
                                </div>
                              ) : (
                                <div>
                                  <label className="modal-label">Day</label>
                                  <select
                                    className="input"
                                    value={draft.dayOfWeek}
                                    onChange={(e) => setDraft({ ...draft, dayOfWeek: e.target.value })}
                                  >
                                    <option value="mon">Monday</option>
                                    <option value="tue">Tuesday</option>
                                    <option value="wed">Wednesday</option>
                                    <option value="thu">Thursday</option>
                                    <option value="fri">Friday</option>
                                    <option value="sat">Saturday</option>
                                    <option value="sun">Sunday</option>
                                  </select>
                                </div>
                              )}
                              <div>
                                <label className="modal-label">Window</label>
                                <select
                                  className="input"
                                  value={draft.timeWindow}
                                  onChange={(e) =>
                                    setDraft({ ...draft, timeWindow: e.target.value as AlertTimeWindow })
                                  }
                                >
                                  <option value="any">All day</option>
                                  <option value="morning">Morning</option>
                                  <option value="afternoon">Afternoon</option>
                                  <option value="evening">Twilight</option>
                                </select>
                              </div>
                              <div>
                                <label className="modal-label">Players</label>
                                <select
                                  className="input"
                                  value={draft.players}
                                  onChange={(e) =>
                                    setDraft({
                                      ...draft,
                                      players: clampAlertPlayers(Number(e.target.value)),
                                    })
                                  }
                                >
                                  <option value="1">1</option>
                                  <option value="2">2</option>
                                  <option value="3">3</option>
                                  <option value="4">4</option>
                                </select>
                              </div>
                            </div>

                            <div className="account-pref-actions">
                              <button
                                type="button"
                                className="btn btn-primary"
                                disabled={busy}
                                onClick={() => void saveEdit(p.id)}
                              >
                                {busy ? '…' : 'Save'}
                              </button>
                              <button type="button" className="btn" disabled={busy} onClick={cancelEdit}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="account-pref-summary">{summarizePref(p)}</div>
                            <div className="account-pref-detail">{detailLine(p)}</div>
                            <div className="account-pref-actions">
                              <button type="button" className="btn" disabled={busy} onClick={() => startEdit(p)}>
                                Edit
                              </button>
                              {p.active ? (
                                <button
                                  type="button"
                                  className="btn"
                                  disabled={busy}
                                  onClick={() => void setPrefActive(p.id, false)}
                                >
                                  {busy ? '…' : 'Pause'}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  disabled={busy}
                                  onClick={() => void setPrefActive(p.id, true)}
                                >
                                  {busy ? '…' : 'Resume'}
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn account-pref-remove"
                                disabled={busy}
                                onClick={() => void removePref(p.id)}
                              >
                                {busy ? '…' : 'Remove'}
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <details className="account-settings">
              <summary className="account-settings-summary">Delivery settings</summary>
              <div className="account-settings-body">
                <label className="account-label">Alert channels</label>
                <p className="account-channel-value">Email{pushEnabled ? ' · Push' : ''}</p>
                <p className="account-channel-note">
                  Email alerts go to <strong>{user.email}</strong>. SMS is paused for now.
                </p>
                <div className="account-push-row">
                  <div className="account-push-copy">
                    <div className="account-push-title">Browser push</div>
                    <p className="account-push-note">
                      {canUsePush
                        ? 'Instant alerts on this device when a matching tee time opens. Works best after you install Tee-Time.'
                        : 'Push isn’t available in this browser. Open Tee-Time in Chrome or Safari on your phone.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`btn account-push-btn${pushEnabled ? ' is-on' : ' btn-primary'}`}
                    disabled={!canUsePush || pushBusy || loading}
                    onClick={() => void onTogglePush()}
                  >
                    {pushBusy ? '…' : pushEnabled ? 'On · Turn off' : 'Enable'}
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}

        <button type="button" className="btn account-sign-out" onClick={() => void signOut()}>
          Sign out
        </button>

        <p className="account-legal-links">
          <a href="/privacy.html" target="_blank" rel="noopener noreferrer">
            Privacy
          </a>
          <span aria-hidden> · </span>
          <a href="/terms.html" target="_blank" rel="noopener noreferrer">
            Terms
          </a>
        </p>
      </div>
    </div>
  );
}
