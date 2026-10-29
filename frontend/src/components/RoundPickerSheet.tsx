import { useId } from 'react';
import type { HolesFilter } from '../lib/holesFilter';
import { FilterSheet } from './FilterSheet';

const PLAYERS = [1, 2, 3, 4] as const;
const HOLES: { value: HolesFilter; label: string }[] = [
  { value: 9, label: '9 holes' },
  { value: 18, label: '18 holes' },
  { value: 'any', label: 'Any holes' },
];

type RoundPickerSheetProps = {
  open: boolean;
  players: 1 | 2 | 3 | 4;
  holes: HolesFilter;
  onClose: () => void;
  onPlayers: (players: 1 | 2 | 3 | 4) => void;
  onHoles: (holes: HolesFilter) => void;
};

export function RoundPickerSheet({ open, players, holes, onClose, onPlayers, onHoles }: RoundPickerSheetProps) {
  const playersLabelId = useId();
  const holesLabelId = useId();
  return (
    <FilterSheet open={open} title="Round" closeLabel="Close round" onClose={onClose}>
      <div className="location-sheet-radius">
        <div className="location-sheet-radius-label" id={playersLabelId}>
          Players
        </div>
        <div className="location-sheet-radius-row" role="radiogroup" aria-labelledby={playersLabelId}>
          {PLAYERS.map((n) => {
            const on = players === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={on}
                className={`location-sheet-radius-chip${on ? ' is-on' : ''}`}
                onClick={() => onPlayers(n)}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
      <div className="location-sheet-radius">
        <div className="location-sheet-radius-label" id={holesLabelId}>
          Holes
        </div>
        <div className="picker-choice-row" role="radiogroup" aria-labelledby={holesLabelId}>
          {HOLES.map((option) => {
            const on = holes === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={option.label}
                className={`location-sheet-radius-chip${on ? ' is-on' : ''}`}
                onClick={() => onHoles(option.value)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </FilterSheet>
  );
}
