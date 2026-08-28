import { useRef } from 'react';
import {
  ALERT_DOW_KEYS,
  ALERT_DOW_SHORT,
  ALERT_WINDOW_OPTIONS,
  describeAlertDraft,
  scheduleWithMode,
  type AlertScheduleMode,
  type AlertScheduleValue,
  type AlertTimeWindow,
} from '../lib/alertPrefs';
import { formatDateLong, shiftYmd } from '../lib/time';

export function AlertScheduleFields({
  value,
  onChange,
  todayYmd,
}: {
  value: AlertScheduleValue;
  onChange: (next: AlertScheduleValue) => void;
  todayYmd: string;
}) {
  const dateInputRef = useRef<HTMLInputElement>(null);
  const summary = describeAlertDraft(value);

  const openDatePicker = () => {
    const el = dateInputRef.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.click();
    }
  };

  const setMode = (mode: AlertScheduleMode) => {
    onChange(scheduleWithMode(value, mode, todayYmd));
  };

  return (
    <div className="alert-fields">
      <div className="modal-seg" role="group" aria-label="Alert type">
        <button
          className={`btn modal-seg-btn${value.mode === 'specific' ? ' on' : ''}`}
          type="button"
          onClick={() => setMode('specific')}
        >
          One-time
        </button>
        <button
          className={`btn modal-seg-btn${value.mode === 'weekly' ? ' on' : ''}`}
          type="button"
          onClick={() => setMode('weekly')}
        >
          Weekly
        </button>
      </div>
      <p className="alert-fields-hint">{summary.helperLine}</p>

      {value.mode === 'weekly' ? (
        <div>
          <div className="modal-label" id="alert-dow-label">
            Day
          </div>
          <div className="alert-chip-row alert-chip-row-days" role="group" aria-labelledby="alert-dow-label">
            {ALERT_DOW_KEYS.map((key, i) => (
              <button
                key={key}
                type="button"
                className={`chip alert-day-chip${value.dayOfWeek === key ? ' on' : ''}`}
                aria-pressed={value.dayOfWeek === key}
                aria-label={ALERT_DOW_SHORT[i]}
                onClick={() => onChange({ ...value, dayOfWeek: key })}
              >
                {ALERT_DOW_SHORT[i]}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="modal-label" id="alert-date-label">
            Date
          </div>
          <div className="modal-date-nudge">
            <button
              type="button"
              className="modal-date-nudge-btn"
              aria-label="Previous day"
              disabled={value.targetDate <= todayYmd}
              onClick={() => {
                const next = shiftYmd(value.targetDate, -1);
                if (next >= todayYmd) onChange({ ...value, targetDate: next });
              }}
            >
              ‹
            </button>
            <div className="alert-date-picker">
              <button
                type="button"
                className="alert-date-friendly"
                aria-labelledby="alert-date-label"
                onClick={openDatePicker}
              >
                {formatDateLong(value.targetDate)}
              </button>
              <input
                ref={dateInputRef}
                className="alert-date-native"
                type="date"
                min={todayYmd}
                value={value.targetDate}
                aria-label="Pick a date"
                onChange={(e) => {
                  const next = e.target.value;
                  if (next && next >= todayYmd) onChange({ ...value, targetDate: next });
                }}
              />
            </div>
            <button
              type="button"
              className="modal-date-nudge-btn"
              aria-label="Next day"
              onClick={() => onChange({ ...value, targetDate: shiftYmd(value.targetDate, 1) })}
            >
              ›
            </button>
          </div>
        </div>
      )}

      <div>
        <div className="modal-label" id="alert-window-label">
          Window
        </div>
        <div className="alert-chip-row" role="group" aria-labelledby="alert-window-label">
          {ALERT_WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip${value.timeWindow === opt.value ? ' on' : ''}`}
              aria-pressed={value.timeWindow === opt.value}
              onClick={() => onChange({ ...value, timeWindow: opt.value as AlertTimeWindow })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="modal-label" id="alert-players-label">
          Players
        </div>
        <div className="alert-chip-row alert-chip-row-players" role="group" aria-labelledby="alert-players-label">
          {([1, 2, 3, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              className={`chip${value.players === n ? ' on' : ''}`}
              aria-pressed={value.players === n}
              onClick={() => onChange({ ...value, players: n })}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="alert-summary" aria-live="polite">
        <div className="alert-summary-kicker">{summary.title}</div>
        <div className="alert-summary-schedule">{summary.scheduleLine}</div>
        <div className="alert-summary-filters">{summary.filtersLine}</div>
      </div>
    </div>
  );
}
