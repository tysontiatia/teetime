import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { SMS_ALERTS_ENABLED } from '../lib/smsAlerts';
import { supabase } from '../lib/supabase';

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

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function formatHm(t: string): string {
  const s = t?.slice(0, 5) || '—';
  return s.length === 5 ? s : t?.slice(0, 8) || '—';
}

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
    .map((i) => DOW_SHORT[i] ?? `?`)
    .join(', ');
  const horizon = p.look_ahead_days != null ? `${p.look_ahead_days}d ahead` : 'open-ended';
  return `Weekly · ${days || '—'} · ${horizon}`;
}

export function AccountPage() {
  const { user, signOut } = useAuth();
  const { courses } = useCourseCatalog();
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPreferenceRow[]>([]);
  const [prefsBusyId, setPrefsBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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
      // Normalize legacy SMS / both profiles to email while SMS is paused.
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

  const courseNameByCatalog = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of courses) m.set(c.catalogName, c.name);
    return m;
  }, [courses]);

  const setPrefActive = async (id: string, active: boolean) => {
    setPrefsBusyId(id);
    const { error } = await supabase.from('notification_preferences').update({ active }).eq('id', id);
    setPrefsBusyId(null);
    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }
    setPrefs((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)));
  };

  const removePref = async (id: string) => {
    setPrefsBusyId(id);
    const { error } = await supabase.from('notification_preferences').delete().eq('id', id);
    setPrefsBusyId(null);
    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }
    setPrefs((prev) => prev.filter((p) => p.id !== id));
  };

  if (!user) {
    return (
      <div className="container" style={{ paddingTop: 32, textAlign: 'center', color: 'var(--muted)' }}>
        Sign in to manage your account.
      </div>
    );
  }

  return (
    <div className="container account-page">
      <h1 className="account-page-title">Account</h1>
      <p className="account-page-email">{user.email}</p>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <label className="account-label">Alert channel</label>
            <p style={{ fontSize: 14, color: 'var(--ink)', marginTop: 4, fontWeight: 600 }}>Email</p>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, lineHeight: 1.45 }}>
              Alerts go to <strong style={{ color: 'var(--ink)' }}>{user.email}</strong>. SMS is paused for now —
              email covers the same openings.
            </p>
          </div>

          {message ? (
            <div className={`account-msg${message.type === 'ok' ? ' is-ok' : ' is-err'}`}>{message.text}</div>
          ) : null}

          <div className="account-prefs-section">
            <h2 className="account-prefs-title">Tee time alerts</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.45 }}>
              Active alerts you set from the finder (🔔). We check courses every few minutes when times match your
              filters.
            </p>
            {prefs.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--muted)' }}>
                No alerts yet.{' '}
                <Link to="/" style={{ fontWeight: 800, color: 'var(--green-2)' }}>
                  Open the finder
                </Link>{' '}
                and use “Get notified” on a course.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {prefs.map((p) => {
                  const title = courseNameByCatalog.get(p.course_id) ?? p.course_id;
                  const busy = prefsBusyId === p.id;
                  return (
                    <li key={p.id} className={`account-pref-item${p.active ? '' : ' is-paused'}`}>
                      <div className="account-pref-title">{title}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{summarizePref(p)}</div>
                      <div style={{ fontSize: 12, color: 'var(--subtle)' }}>
                        {formatHm(p.earliest_time)}–{formatHm(p.latest_time)} · {p.players} player
                        {p.players !== 1 ? 's' : ''} · min spots {p.min_spots}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                        {p.active ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => void setPrefActive(p.id, false)}
                            style={{ padding: '6px 12px', fontSize: 13 }}
                          >
                            {busy ? '…' : 'Pause'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={busy}
                            onClick={() => void setPrefActive(p.id, true)}
                            style={{ padding: '6px 12px', fontSize: 13 }}
                          >
                            {busy ? '…' : 'Resume'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn account-pref-remove"
                          disabled={busy}
                          onClick={() => void removePref(p.id)}
                          style={{ padding: '6px 12px', fontSize: 13 }}
                        >
                          {busy ? '…' : 'Remove'}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
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
  );
}
