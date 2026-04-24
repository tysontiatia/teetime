import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Course } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';
import { toYmd } from '../lib/time';

type Mode = 'specific' | 'weekly';

function windowToRange(w: 'any' | 'morning' | 'afternoon' | 'evening'): { earliest: string; latest: string } {
  switch (w) {
    case 'morning':
      return { earliest: '05:00:00', latest: '11:59:00' };
    case 'afternoon':
      return { earliest: '12:00:00', latest: '16:59:00' };
    case 'evening':
      return { earliest: '17:00:00', latest: '21:00:00' };
    default:
      return { earliest: '00:00:00', latest: '23:59:00' };
  }
}

const DOW_MAP: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** Profile `phone` is stored E.164; accept 10- or 11-digit US when normalized. */
function profileHasValidUsPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return true;
  if (digits.length === 11 && digits.startsWith('1')) return true;
  return false;
}

type AlertMessage = {
  type: 'ok' | 'err';
  text: string;
  showAccountLink?: boolean;
};

export function NotificationModal({
  open,
  onClose,
  course,
  defaultDate,
}: {
  open: boolean;
  onClose: () => void;
  course: Course | null;
  defaultDate?: string;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>('specific');
  const [dayOfWeek, setDayOfWeek] = useState('sat');
  const [timeWindow, setTimeWindow] = useState<'any' | 'morning' | 'afternoon' | 'evening'>('any');
  const [players, setPlayers] = useState<1 | 2 | 3 | 4>(2);
  const [targetDate, setTargetDate] = useState(() => defaultDate || toYmd(new Date()));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<AlertMessage | null>(null);

  const title = useMemo(() => (course ? `${course.name} (${course.city})` : 'Course'), [course]);

  useEffect(() => {
    if (open && defaultDate) setTargetDate(defaultDate);
  }, [open, defaultDate]);

  if (!open) return null;

  const save = async () => {
    setMessage(null);
    if (!course) return;
    if (!user) {
      setMessage({ type: 'err', text: 'Sign in with Google (header) to save alerts.' });
      return;
    }

    const { earliest, latest } = windowToRange(timeWindow);
    const days_of_week = mode === 'weekly' ? [DOW_MAP[dayOfWeek] ?? 6] : [];

    const row = {
      user_id: user.id,
      course_id: course.catalogName,
      days_of_week,
      earliest_time: earliest,
      latest_time: latest,
      min_spots: players,
      active: true,
      target_date: mode === 'specific' ? targetDate : null,
      players,
      look_ahead_days: mode === 'weekly' ? 14 : null,
    };

    setSaving(true);
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('notify_via, phone')
      .eq('id', user.id)
      .single();

    if (profileErr) {
      setSaving(false);
      setMessage({ type: 'err', text: profileErr.message });
      return;
    }

    const via = (profile?.notify_via ?? 'email') as string;
    const hasPhone = profileHasValidUsPhone(profile?.phone);

    if (via === 'sms' && !hasPhone) {
      setSaving(false);
      setMessage({
        type: 'err',
        text: 'Your alert channel is set to SMS, but there is no US mobile number on your profile yet. Add one on Account, then save this alert again.',
        showAccountLink: true,
      });
      return;
    }

    const { error } = await supabase.from('notification_preferences').insert(row);
    setSaving(false);

    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }

    if (via === 'both' && !hasPhone) {
      setMessage({
        type: 'ok',
        text: 'Alert saved. You will get email when times match. Add a phone on Account to get SMS too.',
        showAccountLink: true,
      });
      return;
    }

    const channelLabel = via === 'both' ? 'email and SMS' : via === 'sms' ? 'SMS' : 'email';
    const article = via === 'email' ? 'an' : 'a';
    setMessage({ type: 'ok', text: 'Alert saved. You will get ' + article + ' ' + channelLabel + ' when times match.' });
    setTimeout(() => onClose(), 900);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(520px, 100%)',
          background: 'rgba(255,255,255,0.95)',
          borderRadius: 18,
          border: '1px solid rgba(26,46,26,0.12)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.28)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(26,46,26,0.10)',
            background: 'rgba(233,245,234,0.55)',
          }}
        >
          <div>
            <div style={{ fontWeight: 950, letterSpacing: '-0.02em' }}>Notifications</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{title}</div>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ padding: 14, display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn"
              type="button"
              onClick={() => setMode('specific')}
              style={{
                borderRadius: 999,
                padding: '8px 12px',
                background: mode === 'specific' ? 'var(--green-soft)' : '#fff',
                color: mode === 'specific' ? 'var(--green-2)' : 'var(--muted)',
                borderColor: mode === 'specific' ? 'rgba(45,122,58,0.25)' : 'var(--border)',
                fontWeight: 950,
              }}
            >
              Specific date
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setMode('weekly')}
              style={{
                borderRadius: 999,
                padding: '8px 12px',
                background: mode === 'weekly' ? 'var(--green-soft)' : '#fff',
                color: mode === 'weekly' ? 'var(--green-2)' : 'var(--muted)',
                borderColor: mode === 'weekly' ? 'rgba(45,122,58,0.25)' : 'var(--border)',
                fontWeight: 950,
              }}
            >
              Weekly
            </button>
          </div>

          {mode === 'weekly' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Day
                </label>
                <select className="input" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                  <option value="mon">Monday</option>
                  <option value="tue">Tuesday</option>
                  <option value="wed">Wednesday</option>
                  <option value="thu">Thursday</option>
                  <option value="fri">Friday</option>
                  <option value="sat">Saturday</option>
                  <option value="sun">Sunday</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Window
                </label>
                <select className="input" value={timeWindow} onChange={(e) => setTimeWindow(e.target.value as 'any' | 'morning' | 'afternoon' | 'evening')}>
                  <option value="any">Any</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Date
                </label>
                <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Window
                </label>
                <select className="input" value={timeWindow} onChange={(e) => setTimeWindow(e.target.value as 'any' | 'morning' | 'afternoon' | 'evening')}>
                  <option value="any">Any</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 900, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Players
              </label>
              <select className="input" value={players} onChange={(e) => setPlayers(Number(e.target.value) as 1 | 2 | 3 | 4)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
          </div>

          {message ? (
            <div
              style={{
                padding: 12,
                borderRadius: 14,
                border: `1px solid ${message.type === 'ok' ? 'rgba(45,122,58,0.35)' : 'rgba(180,60,60,0.35)'}`,
                background: message.type === 'ok' ? 'rgba(233,245,234,0.85)' : 'rgba(254,242,242,0.9)',
                color: message.type === 'ok' ? 'var(--green-2)' : '#7f1d1d',
                fontSize: 14,
              }}
            >
              <div>{message.text}</div>
              {message.showAccountLink ? (
                <div style={{ marginTop: 10 }}>
                  <Link
                    to="/account"
                    onClick={onClose}
                    style={{
                      fontWeight: 800,
                      color: message.type === 'ok' ? 'var(--green-2)' : '#991b1b',
                      textDecoration: 'underline',
                      textUnderlineOffset: 2,
                    }}
                  >
                    Open Account →
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ padding: 14, borderTop: '1px solid rgba(26,46,26,0.10)', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save alert'}
          </button>
        </div>
      </div>
    </div>
  );
}
