import type { MouseEvent } from 'react';

/**
 * Native selects and date fields on macOS only open from the arrow.
 * Call this on mouse down of the whole control so any click opens the picker.
 */
export function openWrappedPicker(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest('button, a')) return;
  const control = event.currentTarget.querySelector('select, input[type="date"]');
  if (!(control instanceof HTMLSelectElement) && !(control instanceof HTMLInputElement)) return;
  event.preventDefault();
  try {
    control.showPicker();
  } catch {
    control.focus();
  }
}
