import { useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { DatePickerSheet } from './DatePickerSheet';
import { FilterSheet } from './FilterSheet';
import { FinderDayOutlook } from './FinderDayOutlook';
import { FinderHeaderSlotsContext } from '../state/FinderHeaderSlots';
import { holesFilterOptionLabel, type HolesFilter } from '../lib/holesFilter';
import { formatDateCompact } from '../lib/time';
import type { TimeOfDayPreset } from '../types';

const PLAYERS = [1, 2, 3, 4] as const;
const HOLES: { value: HolesFilter; label: string }[] = [
  { value: 18, label: '18 holes' },
  { value: 9, label: '9 holes' },
  { value: 'any', label: 'Any holes' },
];
const TIMES: { value: TimeOfDayPreset; label: string }[] = [
  { value: 'morning', label: 'Morning' },
  { value: 'afternoon', label: 'Afternoon' },
  { value: 'evening', label: 'Twilight' },
  { value: 'any', label: 'Anytime' },
];

type Picker = 'players' | 'holes' | 'round' | 'tod' | null;

type Props = {
  courseName: string;
  date: string;
  todayYmd: string;
  prevDateDisabled: boolean;
  onShiftDate: (delta: number) => void;
  onDate: (ymd: string) => void;
  players: 1 | 2 | 3 | 4;
  onPlayers: (players: 1 | 2 | 3 | 4) => void;
  holes: HolesFilter;
  /** Nine-hole courses stay on 9. The segment is a label. */
  holesLocked: boolean;
  onHoles: (holes: HolesFilter) => void;
  tod: TimeOfDayPreset;
  onTod: (tod: TimeOfDayPreset) => void;
  sort: 'soonest' | 'price';
  onSort: (sort: 'soonest' | 'price') => void;
  countLabel: string;
  finding: boolean;
  lat?: number;
  lng?: number;
};

export function CourseAvailabilityBar(props: Props) {
  const slots = useContext(FinderHeaderSlotsContext);
  const [dateOpen, setDateOpen] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const setCourseBar = slots?.setCourseBar;

  useEffect(() => {
    if (!setCourseBar) return;
    setCourseBar(true);
    return () => setCourseBar(false);
  }, [setCourseBar]);

  if (!slots?.searchEl || !slots.metaEl) {
    return (
      <>
        <DatePickerSheet
          open={dateOpen}
          value={props.date}
          today={props.todayYmd}
          onClose={() => setDateOpen(false)}
          onSelect={(ymd) => {
            props.onDate(ymd);
            setDateOpen(false);
          }}
        />
        {pickerSheet(picker, setPicker, props)}
      </>
    );
  }

  const holesLabel = props.holesLocked ? '9 holes' : holesFilterOptionLabel(props.holes);

  const search = (
    <div className="find-search-bar is-desktop">
      <button
        type="button"
        className="find-search-date"
        onClick={() => setDateOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={dateOpen}
        aria-label={`Date, ${formatDateCompact(props.date)}`}
      >
        <span className="find-search-date-label">{formatDateCompact(props.date)}</span>
      </button>
      <div className="find-query is-flat" role="group" aria-label="Tee time availability">
        <div className="find-query-seg is-course" title={props.courseName}>
          <span className="find-query-value">{props.courseName}</span>
        </div>
        <button
          type="button"
          className="find-query-seg is-round"
          onClick={() => setPicker('round')}
          aria-haspopup="dialog"
          aria-expanded={picker === 'round'}
          aria-label={`Round, ${props.players} · ${holesLabel}`}
        >
          <span className="find-query-value">
            {props.players} · {holesLabel}
          </span>
        </button>
        <button
          type="button"
          className="find-query-seg is-time"
          onClick={() => setPicker('tod')}
          aria-haspopup="dialog"
          aria-expanded={picker === 'tod'}
          aria-label={`Time, ${TIMES.find((option) => option.value === props.tod)?.label ?? 'Anytime'}`}
        >
          <span className="find-query-value">
            {TIMES.find((option) => option.value === props.tod)?.label ?? 'Anytime'}
          </span>
        </button>
      </div>
    </div>
  );

  const meta = (
    <div className="result-meta course-availability-meta">
      <div className="find-results-summary">
        <span className={`result-count${props.finding ? ' is-finding' : ''}`}>
          <strong>{props.countLabel}</strong>
        </span>
        {typeof props.lat === 'number' && typeof props.lng === 'number' ? (
          <FinderDayOutlook dateYmd={props.date} lat={props.lat} lng={props.lng} regionLabel={props.courseName} />
        ) : null}
      </div>
      <div className="find-results-tools">
        <label className="course-availability-sort is-tool">
          <span className="course-availability-sort-label">Sort</span>
          <select
            aria-label="Sort times"
            value={props.sort}
            onChange={(event) => props.onSort(event.target.value === 'price' ? 'price' : 'soonest')}
          >
            <option value="soonest">Earliest</option>
            <option value="price">Price</option>
          </select>
        </label>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(search, slots.searchEl)}
      {createPortal(meta, slots.metaEl)}
      <DatePickerSheet
        open={dateOpen}
        value={props.date}
        today={props.todayYmd}
        onClose={() => setDateOpen(false)}
        onSelect={(ymd) => {
          props.onDate(ymd);
          setDateOpen(false);
        }}
      />
      {pickerSheet(picker, setPicker, props)}
    </>
  );
}

function pickerSheet(picker: Picker, setPicker: (picker: Picker) => void, props: Props) {
  const close = () => setPicker(null);
  if (picker === 'players') {
    return (
      <FilterSheet open title="Players" closeLabel="Close players" onClose={close}>
        <ChoiceRow
          label="Players"
          options={PLAYERS.map((n) => ({ value: String(n), label: n === 1 ? '1 player' : `${n} players` }))}
          selected={String(props.players)}
          onSelect={(value) => {
            props.onPlayers(Number(value) as 1 | 2 | 3 | 4);
            close();
          }}
        />
      </FilterSheet>
    );
  }
  if (picker === 'holes') {
    return (
      <FilterSheet open title="Holes" closeLabel="Close holes" onClose={close}>
        <ChoiceRow
          label="Holes"
          options={HOLES.map((option) => ({ value: String(option.value), label: option.label }))}
          selected={String(props.holes)}
          onSelect={(value) => {
            props.onHoles(value === 'any' ? 'any' : value === '9' ? 9 : 18);
            close();
          }}
        />
      </FilterSheet>
    );
  }
  if (picker === 'round') {
    return (
      <FilterSheet open title="Round" closeLabel="Close round" onClose={close}>
        <ChoiceRow
          label="Players"
          options={PLAYERS.map((n) => ({ value: String(n), label: n === 1 ? '1 player' : `${n} players` }))}
          selected={String(props.players)}
          onSelect={(value) => props.onPlayers(Number(value) as 1 | 2 | 3 | 4)}
        />
        {props.holesLocked ? null : (
          <ChoiceRow
            label="Holes"
            options={HOLES.map((option) => ({ value: String(option.value), label: option.label }))}
            selected={String(props.holes)}
            onSelect={(value) => props.onHoles(value === 'any' ? 'any' : value === '9' ? 9 : 18)}
          />
        )}
      </FilterSheet>
    );
  }
  if (picker === 'tod') {
    return (
      <FilterSheet open title="Time of day" closeLabel="Close time of day" onClose={close}>
        <ChoiceRow
          label="Time of day"
          options={TIMES.map((option) => ({ value: option.value, label: option.label }))}
          selected={props.tod}
          onSelect={(value) => {
            props.onTod(value as TimeOfDayPreset);
            close();
          }}
        />
      </FilterSheet>
    );
  }
  return null;
}

function ChoiceRow({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="location-sheet-radius">
      <div className="picker-choice-row" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const on = option.value === selected;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`location-sheet-radius-chip${on ? ' is-on' : ''}`}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
