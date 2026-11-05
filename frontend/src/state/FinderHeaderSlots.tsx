import { createContext } from 'react';

export type FinderHeaderSlots = {
  searchEl: HTMLElement | null;
  filtersEl: HTMLElement | null;
  metaEl: HTMLElement | null;
  setSearchEl: (el: HTMLElement | null) => void;
  setFiltersEl: (el: HTMLElement | null) => void;
  setMetaEl: (el: HTMLElement | null) => void;
  /** Desktop course page fills the header with the availability bar. */
  courseBar: boolean;
  setCourseBar: (on: boolean) => void;
};

export const FinderHeaderSlotsContext = createContext<FinderHeaderSlots | null>(null);
