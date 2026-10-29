import { createContext } from 'react';

export type FinderHeaderSlots = {
  searchEl: HTMLElement | null;
  filtersEl: HTMLElement | null;
  metaEl: HTMLElement | null;
  setSearchEl: (el: HTMLElement | null) => void;
  setFiltersEl: (el: HTMLElement | null) => void;
  setMetaEl: (el: HTMLElement | null) => void;
};

export const FinderHeaderSlotsContext = createContext<FinderHeaderSlots | null>(null);
