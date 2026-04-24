import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '../state/AuthContext';
import { supabase } from '../lib/supabase';

type NotifyVia = 'email' | 'sms' | 'both';

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
  const [phone, setPhone] = useState('');
  const [notifyVia, setNotifyVia] = useState<NotifyVia>('email');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('profiles')
      .select('phone, notify_via')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setPhone(data.phone ? formatPhoneDisplay(data.phone.replace(/^\+1/, '')) : '');
          setNotifyVia((data.notify_via as NotifyVia) || 'email');
        }
        setLoading(false);
      });
  }, [user]);

  if (!user) {
    return (
      <div className="container" style={{ paddingTop: 32, textAlign: 'center', color: 'var(--muted)' }}>
        Sign in to manage your account.
      </div>
    );
  }

  const save = async () => {
    setMessage(null);

    if ((notifyVia === 'sms' || notifyVia === 'both') && !toE164(phone)) {
      setMessage({ type: 'err', text: 'Enter a valid 10-digit US phone number to enable SMS.' });
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
      setMessage({ type: 'ok', text: 'Saved.' });
    }
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
    <div className="container" style={{ maxWidth: 480, paddingTop: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 950, marginBottom: 4 }}>Account</h1>
      <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24 }}>{user.email}</p>

      {loading ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
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
              US numbers only. Required for SMS alerts.
            </p>
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
        </div>
      )}
    </div>
  );
}
