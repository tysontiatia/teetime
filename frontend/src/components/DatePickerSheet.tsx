import { useEffect, useState } from 'react';
import { formatDateLong, shiftYmd, toYmd } from '../lib/time';
import { FilterSheet } from './FilterSheet';

const HORIZON_DAYS = 180;
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

type DatePickerSheetProps = {
  open: boolean;
  value: string;
  today: string;
  onClose: () => void;
  onSelect: (ymd: string) => void;
};

function monthKey(ymd: string): string {
  return ymd.slice(0, 7);
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number);
  return monthKey(toYmd(new Date(y!, (m ?? 1) - 1 + delta, 1)));
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function calendarCells(key: string): { ymd: string; inMonth: boolean }[] {
  const [y, m] = key.split('-').map(Number);
  const first = new Date(y!, (m ?? 1) - 1, 1);
  const lead = first.getDay();
  const days = new Date(y!, m ?? 1, 0).getDate();
  const cells: { ymd: string; inMonth: boolean }[] = [];
  for (let i = 0; i < lead; i++) {
    cells.push({ ymd: toYmd(new Date(y!, (m ?? 1) - 1, 1 - (lead - i))), inMonth: false });
  }
  for (let day = 1; day <= days; day++) {
    cells.push({ ymd: toYmd(new Date(y!, (m ?? 1) - 1, day)), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const [yy, mm, dd] = cells[cells.length - 1]!.ymd.split('-').map(Number);
    cells.push({ ymd: toYmd(new Date(yy!, (mm ?? 1) - 1, (dd ?? 1) + 1)), inMonth: false });
  }
  return cells;
}

export function DatePickerSheet({ open, value, today, onClose, onSelect }: DatePickerSheetProps) {
  const maxYmd = shiftYmd(today, HORIZON_DAYS);
  const [month, setMonth] = useState(() => monthKey(value));

  useEffect(() => {
    if (open) setMonth(monthKey(value));
  }, [open, value]);

  const minMonth = monthKey(today);
  const maxMonth = monthKey(maxYmd);

  return (
    <FilterSheet open={open} title="Date" closeLabel="Close date" onClose={onClose}>
      <div className="date-sheet-cal">
        <div className="date-sheet-month">
          <button
            type="button"
            className="date-sheet-nav"
            aria-label="Previous month"
            disabled={month <= minMonth}
            onClick={() => setMonth((current) => shiftMonth(current, -1))}
          >
            ‹
          </button>
          <div className="date-sheet-month-label">{monthLabel(month)}</div>
          <button
            type="button"
            className="date-sheet-nav"
            aria-label="Next month"
            disabled={month >= maxMonth}
            onClick={() => setMonth((current) => shiftMonth(current, 1))}
          >
            ›
          </button>
        </div>
        <div className="date-sheet-weekdays" aria-hidden>
          {WEEKDAYS.map((label, i) => (
            <div key={`${label}-${i}`} className="date-sheet-weekday">
              {label}
            </div>
          ))}
        </div>
        <div className="date-sheet-grid" role="grid" aria-label={monthLabel(month)}>
          {calendarCells(month).map((cell) => {
            const disabled = cell.ymd < today || cell.ymd > maxYmd;
            const selected = cell.ymd === value;
            return (
              <button
                key={cell.ymd}
                type="button"
                role="gridcell"
                className={`date-sheet-day${cell.inMonth ? '' : ' is-out'}${selected ? ' is-on' : ''}${
                  cell.ymd === today ? ' is-today' : ''
                }`}
                aria-label={formatDateLong(cell.ymd)}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSelect(cell.ymd)}
              >
                {Number(cell.ymd.slice(8, 10))}
              </button>
            );
          })}
        </div>
      </div>
    </FilterSheet>
  );
}
