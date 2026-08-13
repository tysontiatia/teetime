import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  appleMapsDirectionsUrl,
  googleMapsDirectionsUrl,
  type MapsCourse,
} from '../lib/mapsLinks';

export function DirectionsChoiceSheet({
  open,
  onClose,
  course,
}: {
  open: boolean;
  onClose: () => void;
  course: MapsCourse;
}) {
  useBodyScrollLock(open);
  if (!open) return null;

  const googleHref = googleMapsDirectionsUrl(course);
  const appleHref = appleMapsDirectionsUrl(course);

  return (
    <div
      className="directions-sheet-backdrop"
      role="presentation"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className="directions-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directions-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="directions-sheet-handle" aria-hidden />
        <h2 id="directions-sheet-title" className="directions-sheet-title">
          Get directions
        </h2>
        <p className="directions-sheet-sub">Open in your maps app</p>
        <div className="directions-sheet-actions">
          <a
            className="directions-sheet-option"
            href={appleHref}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            Apple Maps
          </a>
          <a
            className="directions-sheet-option"
            href={googleHref}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            Google Maps
          </a>
          <button type="button" className="directions-sheet-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
