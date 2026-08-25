import { useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

export function SlotActionSheet({
  open,
  onClose,
  courseName,
  timeLabel,
  metaLabel,
  bookHref,
  viewHref,
  needsAuth = false,
  resumeBook = false,
  signingIn = false,
  onBook,
  onShare,
}: {
  open: boolean;
  onClose: () => void;
  courseName: string;
  timeLabel: string;
  metaLabel: string;
  bookHref: string | null;
  viewHref?: string | null;
  /** Logged-out: both actions continue with Google. */
  needsAuth?: boolean;
  /** After Google, Book is a same-gesture "Open course site" link. */
  resumeBook?: boolean;
  signingIn?: boolean;
  onBook?: () => void;
  onShare: () => void;
}) {
  const titleId = useId();
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const showView = !bookHref && Boolean(viewHref);
  const bookIsButton = Boolean(bookHref && needsAuth && onBook && !resumeBook);
  const bookLabel = resumeBook
    ? 'Open course site'
    : needsAuth
      ? 'Continue with Google to book'
      : 'Book on course site';
  const shareLabel = needsAuth ? 'Continue with Google to share' : 'Share with friends';

  return (
    <div
      className="directions-sheet-backdrop slot-action-sheet-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="directions-sheet slot-action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="directions-sheet-handle" aria-hidden />
        <h2 id={titleId} className="directions-sheet-title">
          {timeLabel}
        </h2>
        <p className="directions-sheet-sub">
          {courseName}
          {metaLabel ? (
            <>
              <br />
              {metaLabel}
            </>
          ) : null}
        </p>
        {needsAuth ? (
          <p className="slot-action-sheet-hint">
            New here? Google creates your account in one tap.
          </p>
        ) : null}
        {resumeBook ? (
          <p className="slot-action-sheet-hint">You&apos;re signed in. Open the course site to book.</p>
        ) : null}
        <div className="directions-sheet-actions">
          {bookIsButton ? (
            <button
              type="button"
              className="directions-sheet-option"
              disabled={signingIn}
              onClick={onBook}
            >
              {signingIn ? 'Opening Google…' : bookLabel}
            </button>
          ) : bookHref ? (
            <a
              className={`directions-sheet-option${resumeBook ? ' is-primary' : ''}`}
              href={bookHref}
              target="_blank"
              rel="noreferrer"
              onClick={onClose}
            >
              {bookLabel}
            </a>
          ) : null}
          <button
            type="button"
            className="directions-sheet-option"
            disabled={signingIn}
            onClick={onShare}
          >
            {signingIn && !bookIsButton ? 'Opening Google…' : shareLabel}
          </button>
          {showView && viewHref ? (
            <Link className="directions-sheet-option" to={viewHref} onClick={onClose}>
              View course
            </Link>
          ) : null}
          <button type="button" className="directions-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
