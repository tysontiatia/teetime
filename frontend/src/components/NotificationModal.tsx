import { useEffect, useMemo, useState } from 'react';
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

type AlertMessage = {
  type: 'ok' | 'err';
  text: string;
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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
    const { error } = await supabase.from('notification_preferences').insert(row);
    setSaving(false);

    if (error) {
      setMessage({ type: 'err', text: error.message });
      return;
    }

    setMessage({ type: 'ok', text: 'Alert saved. You will get an email when times match.' });
    setTimeout(() => onClose(), 900);
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
              Notifications
            </h2>
            <p className="modal-header-sub">{title}</p>
          </div>
          <button className="btn btn-ghost" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-seg">
            <button
              className={`btn modal-seg-btn${mode === 'specific' ? ' on' : ''}`}
              type="button"
              onClick={() => setMode('specific')}
            >
              Specific date
            </button>
            <button
              className={`btn modal-seg-btn${mode === 'weekly' ? ' on' : ''}`}
              type="button"
              onClick={() => setMode('weekly')}
            >
              Weekly
            </button>
          </div>

          {mode === 'weekly' ? (
            <div className="modal-grid-2">
              <div>
                <label className="modal-label">Day</label>
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
                <label className="modal-label">Window</label>
                <select
                  className="input"
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value as 'any' | 'morning' | 'afternoon' | 'evening')}
                >
                  <option value="any">Any</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="modal-grid-2">
              <div>
                <label className="modal-label">Date</label>
                <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </div>
              <div>
                <label className="modal-label">Window</label>
                <select
                  className="input"
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value as 'any' | 'morning' | 'afternoon' | 'evening')}
                >
                  <option value="any">Any</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </select>
              </div>
            </div>
          )}

          <div className="modal-grid-2">
            <div>
              <label className="modal-label">Players</label>
              <select className="input" value={players} onChange={(e) => setPlayers(Number(e.target.value) as 1 | 2 | 3 | 4)}>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
              </select>
            </div>
          </div>

          {message ? (
            <div className={`modal-msg ${message.type}`}>
              <div>{message.text}</div>
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
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
