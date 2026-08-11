import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { useAlertActivity } from '../state/AlertActivityContext';
import { SMS_ALERTS_ENABLED } from '../lib/smsAlerts';
import { supabase } from '../lib/supabase';
import { toYmd } from '../lib/time';
import {
  alertActivityHeadline,
  formatAlertActivityWhen,
  formatAlertPlayDate,
  formatAlertSlotSummary,
} from '../lib/alertActivity';
import { SignedOutGate } from '../components/SignedOutGate';
import { CoursePhoto } from '../components/CoursePhoto';
import { AlertsIcon } from '../components/icons/AppIcons';
import { useIsCompactShell } from '../hooks/useMediaQuery';
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

type AlertsTab = 'alerts' | 'recent';

const DOW_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'] as const;

function prefFrequencyBadge(p: NotificationPreferenceRow): string {
  if (!p.active) return 'Paused';
  if (p.target_date) return 'One-time';
  return 'Repeats weekly';
}

function prefDateLabel(p: NotificationPreferenceRow): string {
  if (p.target_date) {
    const d = new Date(p.target_date + 'T12:00:00');
    return Number.isNaN(d.getTime())
      ? p.target_date
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const days = (p.days_of_week ?? []).slice().sort((a, b) => a - b);
  if (days.length === 0) return 'Any day';
  if (days.length === 1) return DOW_PLURAL[days[0]] ?? 'Weekly';
  return days.map((i) => ALERT_DOW_SHORT[i] ?? '?').join(', ');
}

function prefPlayersLabel(p: NotificationPreferenceRow): string {
  const n = p.players;
  return `${n} player${n !== 1 ? 's' : ''}`;
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

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="5" width="16" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v4.5l3 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.2 19c.4-2.2 1.7-3.5 3.6-3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 21V4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 5h10l-2.2 3.5L16 12H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  const isCompact = useIsCompactShell();
  const { courses } = useCourseCatalog();
  const { items: recentItems, loading: recentLoading, markSeen } = useAlertActivity();
  const todayYmd = toYmd(new Date());
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPreferenceRow[]>([]);
  const [prefsBusyId, setPrefsBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [tab, setTab] = useState<AlertsTab>('alerts');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void markSeen();
  }, [user, markSeen]);

  useEffect(() => {
    if (!menuOpenId) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.(`[data-pref-menu="${menuOpenId}"]`)) return;
      setMenuOpenId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpenId]);

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
      await loadPrefs(user.id);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadPrefs]);

  const courseByCatalog = useMemo(() => {
    const m = new Map<string, (typeof courses)[number]>();
    for (const c of courses) m.set(c.catalogName, c);
    return m;
  }, [courses]);

  const courseNameByCatalog = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courses) m.set(c.catalogName, c.name);
    return m;
  }, [courses]);

  const courseIdByCatalog = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courses) m.set(c.catalogName, c.id);
    return m;
  }, [courses]);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMessage({ type, text });
  };

  const startEdit = (p: NotificationPreferenceRow) => {
    setMenuOpenId(null);
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
    setMenuOpenId(null);
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
    setMenuOpenId(null);
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

  if (!user) {
    /* Compact shell: AppShell opens the auth modal over Search instead of this page. */
    if (isCompact) return null;
    return (
      <SignedOutGate returnTo="/account">
        Get email when tee times open. If you&apos;re new to Tee-Time, we&apos;ll create an account for you.
      </SignedOutGate>
    );
  }

  return (
    <div className="container hub-page">
      <div className="hub-page-card">
        <div className="account-page-head">
          <h1 className="hub-page-title">Alerts</h1>
          <p className="hub-page-lede account-page-head-lede">
            We check every few minutes and email you when times match.
          </p>
        </div>

        {loading ? (
          <p className="hub-page-status" style={{ marginTop: 18 }}>
            Loading…
          </p>
        ) : (
          <div className="account-page-stack">
            {message ? (
              <div className={`account-msg${message.type === 'ok' ? ' is-ok' : ' is-err'}`}>{message.text}</div>
            ) : null}

            <div className="account-tabs" role="tablist" aria-label="Alerts sections">
              <button
                type="button"
                role="tab"
                id="account-tab-alerts"
                aria-selected={tab === 'alerts'}
                aria-controls="account-panel-alerts"
                className={`account-tab${tab === 'alerts' ? ' is-on' : ''}`}
                onClick={() => setTab('alerts')}
              >
                Alerts ({prefs.length})
              </button>
              <button
                type="button"
                role="tab"
                id="account-tab-recent"
                aria-selected={tab === 'recent'}
                aria-controls="account-panel-recent"
                className={`account-tab${tab === 'recent' ? ' is-on' : ''}`}
                onClick={() => setTab('recent')}
              >
                Recent ({recentItems.length})
              </button>
            </div>

            {tab === 'alerts' ? (
              <div
                className="account-prefs-section"
                role="tabpanel"
                id="account-panel-alerts"
                aria-labelledby="account-tab-alerts"
              >
                {prefs.length === 0 ? (
                  <p className="account-prefs-empty">
                    No alerts yet. Tap Create alert, then pick a course on Find.
                  </p>
                ) : (
                  <ul className="account-pref-list">
                    {prefs.map((p) => {
                      const course = courseByCatalog.get(p.course_id);
                      const title = course?.name ?? courseNameByCatalog.get(p.course_id) ?? p.course_id;
                      const busy = prefsBusyId === p.id;
                      const editing = editingId === p.id && draft;
                      const menuOpen = menuOpenId === p.id;
                      const badge = prefFrequencyBadge(p);
                      return (
                        <li key={p.id} className={`account-pref-card${p.active ? '' : ' is-paused'}`}>
                          <div className="account-pref-card-main">
                            <div className="account-pref-thumb" aria-hidden>
                              <CoursePhoto
                                src={course?.photoUrl}
                                height={56}
                                className="account-pref-thumb-photo"
                                style={{ height: '100%' }}
                              />
                            </div>
                            <div className="account-pref-body">
                              <div className="account-pref-topline">
                                <div className="account-pref-title">{title}</div>
                                <div className="account-pref-menu" data-pref-menu={p.id}>
                                  <button
                                    type="button"
                                    className="account-pref-menu-btn"
                                    aria-label={`Actions for ${title}`}
                                    aria-expanded={menuOpen}
                                    aria-haspopup="menu"
                                    disabled={busy}
                                    onClick={() => setMenuOpenId(menuOpen ? null : p.id)}
                                  >
                                    <span aria-hidden>⋯</span>
                                  </button>
                                  {menuOpen ? (
                                    <div className="account-pref-menu-panel" role="menu">
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={busy}
                                        onClick={() => startEdit(p)}
                                      >
                                        Edit
                                      </button>
                                      {p.active ? (
                                        <button
                                          type="button"
                                          role="menuitem"
                                          disabled={busy}
                                          onClick={() => void setPrefActive(p.id, false)}
                                        >
                                          Pause
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          role="menuitem"
                                          disabled={busy}
                                          onClick={() => void setPrefActive(p.id, true)}
                                        >
                                          Resume
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="is-danger"
                                        disabled={busy}
                                        onClick={() => void removePref(p.id)}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                              <span className={`account-pref-freq${p.active ? '' : ' is-paused'}`}>{badge}</span>

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
                                <div className="account-pref-grid">
                                  <div className="account-pref-grid-item">
                                    <CalendarIcon />
                                    <span>{prefDateLabel(p)}</span>
                                  </div>
                                  <div className="account-pref-grid-item">
                                    <ClockIcon />
                                    <span>{windowLabel(rangeToWindow(p.earliest_time, p.latest_time))}</span>
                                  </div>
                                  <div className="account-pref-grid-item">
                                    <PlayersIcon />
                                    <span>{prefPlayersLabel(p)}</span>
                                  </div>
                                  <div className="account-pref-grid-item">
                                    <FlagIcon />
                                    <span>Any holes</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="account-create-bar">
                  <Link to="/" className="btn btn-primary account-create-btn">
                    <AlertsIcon size={16} />
                    Create alert
                  </Link>
                </div>
              </div>
            ) : (
              <div
                className="account-recent-section"
                role="tabpanel"
                id="account-panel-recent"
                aria-labelledby="account-tab-recent"
              >
                {recentLoading && recentItems.length === 0 ? (
                  <p className="account-prefs-empty">Loading…</p>
                ) : recentItems.length === 0 ? (
                  <div className="account-recent-empty">
                    <p className="account-prefs-empty">When an alert fires, it shows up here.</p>
                    <button type="button" className="btn account-recent-empty-cta" onClick={() => setTab('alerts')}>
                      View alerts
                    </button>
                  </div>
                ) : (
                  <ul className="account-recent-list">
                    {recentItems.map((item) => {
                      const course = courseByCatalog.get(item.courseId);
                      const title = course?.name ?? courseNameByCatalog.get(item.courseId) ?? item.courseId;
                      const slug = courseIdByCatalog.get(item.courseId);
                      const dateQ = item.targetDate ? `?date=${encodeURIComponent(item.targetDate)}` : '';
                      const href = slug ? `/course/${slug}${dateQ}` : '/';
                      const timesLine =
                        item.slotLabels.length > 0
                          ? formatAlertSlotSummary(item.slotLabels)
                          : alertActivityHeadline(item);
                      const when = formatAlertActivityWhen(item.sentAt);
                      const playDate = formatAlertPlayDate(item.targetDate);
                      return (
                        <li key={item.key} className={`account-recent-card${item.unread ? ' is-new' : ''}`}>
                          <Link to={href} className="account-recent-card-link">
                            <div className="account-recent-thumb" aria-hidden>
                              <CoursePhoto
                                src={course?.photoUrl}
                                height={56}
                                className="account-recent-thumb-photo"
                                style={{ height: '100%' }}
                              />
                            </div>
                            <div className="account-recent-body">
                              <div className="account-recent-title">{title}</div>
                              <div className="account-recent-times">{timesLine}</div>
                              <div className="account-recent-meta">
                                <span>
                                  {playDate}
                                  {when ? ` · ${when}` : ''}
                                </span>
                                <span className="account-recent-cta">View times →</span>
                              </div>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
