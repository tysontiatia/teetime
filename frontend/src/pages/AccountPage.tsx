import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { confirmPhoneVerification, startPhoneVerification } from '../lib/accountPhoneVerify';
import { supabase } from '../lib/supabase';

type NotifyVia = 'email' | 'sms' | 'both';

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

function formatPhoneDisplay(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

export function AccountPage() {
  const { user } = useAuth();
  const { courses } = useCourseCatalog();
  const [phone, setPhone] = useState('');
  const [notifyVia, setNotifyVia] = useState<NotifyVia>('email');
  const [loading, setLoading] = useState(true);
  const [prefs, setPrefs] = useState<NotificationPreferenceRow[]>([]);
  const [prefsBusyId, setPrefsBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [phoneVerifiedAt, setPhoneVerifiedAt] = useState<string | null>(null);
  const [profilePhoneE164, setProfilePhoneE164] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);

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

  const applyProfile = useCallback((prof: {
    phone: string | null;
    notify_via: string | null;
    phone_verified_at: string | null;
  }) => {
    setPhone(prof.phone ? formatPhoneDisplay(prof.phone.replace(/^\+1/, '')) : '');
    setNotifyVia((prof.notify_via as NotifyVia) || 'email');
    setPhoneVerifiedAt(prof.phone_verified_at ?? null);
    setProfilePhoneE164(prof.phone ?? null);
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: prof } = await supabase
        .from('profiles')
        .select('phone, notify_via, phone_verified_at')
        .eq('id', user.id)
        .single();
      if (cancelled) return;
      if (prof) applyProfile(prof);
      await loadPrefs(user.id);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadPrefs, applyProfile]);

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

  const phoneMatchesVerified =
    Boolean(phoneVerifiedAt) &&
    Boolean(toE164(phone)) &&
    Boolean(profilePhoneE164) &&
    toE164(phone) === profilePhoneE164;

  const save = async () => {
    setMessage(null);

    if ((notifyVia === 'sms' || notifyVia === 'both') && !toE164(phone)) {
      setMessage({ type: 'err', text: 'Enter a valid 10-digit US phone number to enable SMS.' });
      return;
    }

    if (notifyVia === 'sms' && toE164(phone) && !phoneMatchesVerified) {
      setMessage({
        type: 'err',
        text: 'SMS-only alerts require a verified mobile number. Send a code below, then verify before saving.',
      });
      return;
    }

    setSaving(true);
    const phoneE164 = phone ? (toE164(phone) ?? null) : null;
    const { error } = await supabase
      .from('profiles')
      .update({ phone: phoneE164, notify_via: notifyVia })
      .eq('id', user.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'err', text: error.message });
    } else {
      const { data: prof } = await supabase
        .from('profiles')
        .select('phone, notify_via, phone_verified_at')
        .eq('id', user.id)
        .single();
      if (prof) applyProfile(prof);
      let ok = 'Saved.';
      if (notifyVia === 'both' && !phoneMatchesVerified) {
        ok += ' SMS will start after you verify this number below.';
      }
      setMessage({ type: 'ok', text: ok });
      if (user) void loadPrefs(user.id);
    }
  };

  const sendVerifyCode = async () => {
    setMessage(null);
    const e164 = toE164(phone);
    if (!e164) {
      setMessage({ type: 'err', text: 'Enter a valid 10-digit US number before sending a code.' });
      return;
    }
    setVerifyBusy(true);
    const { error } = await startPhoneVerification(e164);
    setVerifyBusy(false);
    if (error) setMessage({ type: 'err', text: error });
    else setMessage({ type: 'ok', text: 'Code sent. Check your phone and enter it below.' });
  };

  const submitVerifyCode = async () => {
    setMessage(null);
    const e164 = toE164(phone);
    if (!e164) {
      setMessage({ type: 'err', text: 'Enter your phone number first.' });
      return;
    }
    const digits = verifyCode.replace(/\D/g, '');
    if (digits.length < 4) {
      setMessage({ type: 'err', text: 'Enter the verification code from the text message.' });
      return;
    }
    setVerifyBusy(true);
    const { error } = await confirmPhoneVerification(e164, digits);
    setVerifyBusy(false);
    if (error) {
      setMessage({ type: 'err', text: error });
      return;
    }
    setVerifyCode('');
    const { data: prof } = await supabase
      .from('profiles')
      .select('phone, notify_via, phone_verified_at')
      .eq('id', user.id)
      .single();
    if (prof) applyProfile(prof);
    setMessage({ type: 'ok', text: 'Phone verified. SMS alerts can be delivered to this number.' });
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 12,
    fontWeight: 900,
    color: 'var(--subtle)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 6,
  };

  const channelBtnStyle = (active: boolean): CSSProperties => ({
    flex: 1,
    padding: '10px 8px',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    border: `1px solid ${active ? 'rgba(45,122,58,0.35)' : 'var(--border)'}`,
    background: active ? 'var(--green-soft)' : '#fff',
    color: active ? 'var(--green-2)' : 'var(--muted)',
    cursor: 'pointer',
  });

  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 950, marginBottom: 4 }}>Account</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>{user.email}</p>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <label style={labelStyle}>Phone number</label>
            <input
              className="input"
              type="tel"
              placeholder="(801) 555-1234"
              value={phone}
              onChange={(e) => setPhone(formatPhoneDisplay(e.target.value))}
            />
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              US numbers only. SMS uses Twilio Verify — send a code to confirm this number before alerts are texted.
            </p>
            {phoneMatchesVerified ? (
              <p style={{ fontSize: 13, fontWeight: 800, color: 'var(--green-2)', marginTop: 10 }}>
                ✓ Mobile verified for SMS
              </p>
            ) : (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={verifyBusy || !toE164(phone)}
                    onClick={() => void sendVerifyCode()}
                    style={{ padding: '8px 14px', fontSize: 13 }}
                  >
                    {verifyBusy ? '…' : 'Send code'}
                  </button>
                  <input
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="6-digit code"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    style={{ maxWidth: 140, fontSize: 15, letterSpacing: '0.12em' }}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={verifyBusy || verifyCode.replace(/\D/g, '').length < 4}
                    onClick={() => void submitVerifyCode()}
                    style={{ padding: '8px 14px', fontSize: 13 }}
                  >
                    Verify
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Alert channel</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['email', 'sms', 'both'] as NotifyVia[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  style={channelBtnStyle(notifyVia === v)}
                  onClick={() => setNotifyVia(v)}
                >
                  {v === 'email' ? 'Email' : v === 'sms' ? 'SMS' : 'Both'}
                </button>
              ))}
            </div>
          </div>

          {message && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                border: `1px solid ${message.type === 'ok' ? 'rgba(45,122,58,0.35)' : 'rgba(180,60,60,0.35)'}`,
                background: message.type === 'ok' ? 'rgba(233,245,234,0.85)' : 'rgba(254,242,242,0.9)',
                color: message.type === 'ok' ? 'var(--green-2)' : '#7f1d1d',
                fontSize: 14,
              }}
            >
              {message.text}
            </div>
          )}

          <button
            className="btn btn-primary"
            type="button"
            disabled={saving}
            onClick={() => void save()}
            style={{ alignSelf: 'flex-start', padding: '10px 20px' }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 20 }}>
            <h2 style={{ fontSize: 16, fontWeight: 950, marginBottom: 4 }}>Tee time alerts</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.45 }}>
              Active alerts you set from the finder (🔔). We scan about every 15 minutes when times match your filters.
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
                    <li
                      key={p.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 12,
                        background: p.active ? '#fff' : 'rgba(0,0,0,0.03)',
                        opacity: p.active ? 1 : 0.92,
                      }}
                    >
                      <div style={{ fontWeight: 850, fontSize: 15, marginBottom: 4 }}>{title}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>{summarizePref(p)}</div>
                      <div style={{ fontSize: 12, color: 'var(--subtle)' }}>
                        {formatHm(p.earliest_time)}–{formatHm(p.latest_time)} · {p.players} player{p.players !== 1 ? 's' : ''} · min
                        spots {p.min_spots}
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
                          className="btn"
                          disabled={busy}
                          onClick={() => void removePref(p.id)}
                          style={{ padding: '6px 12px', fontSize: 13, color: '#7f1d1d', borderColor: 'rgba(180,60,60,0.35)' }}
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
    </div>
  );
}
