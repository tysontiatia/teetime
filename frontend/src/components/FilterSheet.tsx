import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

type FilterSheetProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

/** Bottom sheet chrome shared with the place search. */
export function FilterSheet({ open, title, closeLabel, onClose, children }: FilterSheetProps) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useBodyScrollLock(open);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="location-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="location-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="location-sheet-handle" aria-hidden />
        <div className="location-sheet-head">
          <h2 id={titleId} className="location-sheet-title">
            {title}
          </h2>
          <button type="button" className="location-sheet-close" onClick={onClose} aria-label={closeLabel}>
            ✕
          </button>
        </div>
        <div className="location-sheet-body">{children}</div>
      </div>
    </div>
  );
}
