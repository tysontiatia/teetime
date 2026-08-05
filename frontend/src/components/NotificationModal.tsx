import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Course, TimeOfDayPreset } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';
import { toYmd } from '../lib/time';
import {
  ALERT_DOW_KEYS,
  ALERT_DOW_MAP,
  clampAlertPlayers,
  type AlertTimeWindow,
  windowToRange,
} from '../lib/alertPrefs';
import { SignInPromptModal } from './SignInPromptModal';

type Mode = 'specific' | 'weekly';

function todToWindow(tod: TimeOfDayPreset | AlertTimeWindow | undefined): AlertTimeWindow {
  if (tod === 'morning' || tod === 'afternoon' || tod === 'evening' || tod === 'any') return tod;
  return 'any';
}

function dowKeyFromYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(y!, (m ?? 1) - 1, d ?? 1).getDay();
  return ALERT_DOW_KEYS[day] ?? 'sat';
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const next = new Date(y!, (m ?? 1) - 1, (d ?? 1) + deltaDays);
  return toYmd(next);
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

export function NotificationModal({
  open,
  onClose,
  course,
  defaultDate,
  defaultPlayers,
  defaultTimeOfDay,
}: {
  open: boolean;
  onClose: () => void;
  course: Course | null;
  defaultDate?: string;
  defaultPlayers?: number;
  defaultTimeOfDay?: TimeOfDayPreset | AlertTimeWindow;
}) {
  const { user } = useAuth();
  const todayYmd = toYmd(new Date());
  const [mode, setMode] = useState<Mode>('specific');
  const [dayOfWeek, setDayOfWeek] = useState('sat');
  const [timeWindow, setTimeWindow] = useState<AlertTimeWindow>('any');
  const [players, setPlayers] = useState<1 | 2 | 3 | 4>(2);
  const [targetDate, setTargetDate] = useState(() => defaultDate || todayYmd);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<AlertMessage | null>(null);

  const title = useMemo(() => (course ? `${course.name} (${course.city})` : 'Course'), [course]);

  useEffect(() => {
    if (!open) {
      setMessage(null);
      setSaving(false);
      return;
    }
    const date = defaultDate && defaultDate >= todayYmd ? defaultDate : todayYmd;
    setMode('specific');
    setTargetDate(date);
    setDayOfWeek(dowKeyFromYmd(date));
    setPlayers(clampAlertPlayers(defaultPlayers ?? 2));
    setTimeWindow(todToWindow(defaultTimeOfDay));
    setMessage(null);
  }, [open, defaultDate, defaultPlayers, defaultTimeOfDay, todayYmd]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

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
    if (!course) return;

    if (mode === 'specific' && targetDate < todayYmd) {
      setMessage({ type: 'err', text: 'Pick today or a future date.' });
      return;
    }

    const { earliest, latest } = windowToRange(timeWindow);
    const days_of_week = mode === 'weekly' ? [ALERT_DOW_MAP[dayOfWeek] ?? 6] : [];

    const { data: existingRows, error: existingErr } = await supabase
      .from('notification_preferences')
      .select('id, active, target_date, days_of_week')
      .eq('user_id', user.id)
      .eq('course_id', course.catalogName)
      .eq('active', true);

    if (existingErr) {
      setMessage({ type: 'err', text: existingErr.message });
      return;
    }

    const existing = (existingRows ?? []) as ExistingPref[];
    const duplicate = existing.find((row) => {
      if (mode === 'specific') return row.target_date === targetDate;
      if (row.target_date) return false;
      const days = row.days_of_week ?? [];
      return days.length === 1 && days[0] === (ALERT_DOW_MAP[dayOfWeek] ?? 6);
    });

    if (duplicate) {
      setMessage({
        type: 'dup',
        text: 'You already have an active alert for this course and schedule.',
      });
      return;
    }

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

    setMessage({ type: 'ok', text: 'Alert saved. We’ll email you when times match — enable push on Alerts for instant device alerts.' });
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
              Create alert
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
              onClick={() => {
                setMode('specific');
                setMessage(null);
              }}
            >
              Specific date
            </button>
            <button
              className={`btn modal-seg-btn${mode === 'weekly' ? ' on' : ''}`}
              type="button"
              onClick={() => {
                setMode('weekly');
                setMessage(null);
              }}
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
                  onChange={(e) => setTimeWindow(e.target.value as AlertTimeWindow)}
                >
                  <option value="any">All day</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Twilight</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="modal-grid-2">
              <div>
                <label className="modal-label">Date</label>
                <div className="modal-date-nudge">
                  <button
                    type="button"
                    className="modal-date-nudge-btn"
                    aria-label="Previous day"
                    disabled={targetDate <= todayYmd}
                    onClick={() => {
                      const next = shiftYmd(targetDate, -1);
                      if (next >= todayYmd) {
                        setTargetDate(next);
                        setMessage(null);
                      }
                    }}
                  >
                    ‹
                  </button>
                  <input
                    className="input"
                    type="date"
                    min={todayYmd}
                    value={targetDate}
                    onChange={(e) => {
                      setTargetDate(e.target.value);
                      setMessage(null);
                    }}
                  />
                  <button
                    type="button"
                    className="modal-date-nudge-btn"
                    aria-label="Next day"
                    onClick={() => {
                      setTargetDate(shiftYmd(targetDate, 1));
                      setMessage(null);
                    }}
                  >
                    ›
                  </button>
                </div>
              </div>
              <div>
                <label className="modal-label">Window</label>
                <select
                  className="input"
                  value={timeWindow}
                  onChange={(e) => setTimeWindow(e.target.value as AlertTimeWindow)}
                >
                  <option value="any">All day</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Twilight</option>
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
            <div className="modal-email-hint">
              <span className="modal-label">Sends to</span>
              <p className="modal-email-value">{user.email}</p>
            </div>
          </div>

          {message ? (
            <div className={`modal-msg ${message.type === 'dup' ? 'ok' : message.type}`}>
              <div>{message.text}</div>
              {message.type === 'dup' ? (
                <div style={{ marginTop: 8 }}>
                  <Link to="/account" className="detail-text-link" onClick={onClose}>
                    Manage alerts →
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save alert'}
          </button>
        </div>
      </div>
    </div>
  );
}
