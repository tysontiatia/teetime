import type { TimeOfDayPreset } from '../types';
import { saturdayOf, toYmd } from './stayTimes';

export const TIME_OPTIONS: { id: TimeOfDayPreset; label: string }[] = [
  { id: 'any', label: 'Anytime' },
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Twilight' },
];

export function startOfDay(d = new Date()) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function weekendSpan(from = startOfDay()) {
  const day = from.getDay();
  const start = new Date(from);
  if (day !== 0 && day !== 6) start.setDate(from.getDate() + (5 - day));
  const end = new Date(start);
  end.setDate(start.getDate() + ((7 - start.getDay()) % 7));
  const label = start.getMonth() === end.getMonth()
    ? `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.getDate()}`
    : `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return { start, end, label };
}

function monthCells(cursor: Date) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const pad = new Date(year, month, 1).getDay();
  const count = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: pad }, () => null);
  for (let day = 1; day <= count; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function WhenPanel({
  today,
  tomorrow,
  weekend,
  playYmd,
  tod,
  cursor,
  onCursor,
  onPick,
  onTod,
}: {
  today: Date;
  tomorrow: Date;
  weekend: { start: Date; end: Date; label: string };
  playYmd: string | null;
  tod: TimeOfDayPreset;
  cursor: Date;
  onCursor: (next: Date) => void;
  onPick: (ymd: string) => void;
  onTod: (next: TimeOfDayPreset) => void;
}) {
  const cells = monthCells(cursor);
  const monthLabel = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const atCurrentMonth = cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth();
  const weekendYmd = toYmd(saturdayOf(weekend.start));
  const picks = [
    { title: 'Today', sub: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), ymd: toYmd(today) },
    { title: 'Tomorrow', sub: tomorrow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), ymd: toYmd(tomorrow) },
    { title: 'This weekend', sub: weekend.label, ymd: weekendYmd },
  ];
  const weekendOn = playYmd === weekendYmd;
  return (
    <div className="stay-when">
      <div className="stay-when-picks">
        {picks.map((pick) => (
          <button
            key={pick.title}
            type="button"
            className={`stay-pick${playYmd === pick.ymd ? ' is-on' : ''}`}
            onClick={() => onPick(pick.ymd)}
          >
            <span>{pick.title}</span>
            <span>{pick.sub}</span>
          </button>
        ))}
      </div>
      <div className="stay-cal">
        <div className="stay-cal-head">
          <button
            type="button"
            aria-label="Previous month"
            disabled={atCurrentMonth}
            onClick={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          >
            ‹
          </button>
          <span>{monthLabel}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          >
            ›
          </button>
        </div>
        <div className="stay-cal-week">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((letter, i) => (
            <span key={`${letter}${i}`}>{letter}</span>
          ))}
        </div>
        <div className="stay-cal-grid">
          {cells.map((day, i) => {
            if (!day) return <span key={`e${i}`} />;
            const past = day < today;
            const ymd = toYmd(day);
            const on = ymd === playYmd;
            const inWeekend = weekendOn && day >= weekend.start && day <= weekend.end;
            return (
              <button
                key={ymd}
                type="button"
                disabled={past}
                className={`stay-day${on ? ' is-on' : ''}${inWeekend ? ' is-range' : ''}`}
                onClick={() => onPick(ymd)}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
      <div className="stay-tod">
        <div className="stay-tod-label">Time of day</div>
        <div className="stay-tod-row" role="radiogroup" aria-label="Time of day">
          {TIME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={tod === option.id}
              className={`stay-tod-chip${tod === option.id ? ' is-on' : ''}`}
              onClick={() => onTod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
