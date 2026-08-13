import { useState, type ReactNode } from 'react';
import {
  googleMapsDirectionsUrl,
  shouldOfferMapsChoice,
  type MapsCourse,
} from '../lib/mapsLinks';
import { DirectionsChoiceSheet } from './DirectionsChoiceSheet';

type Props = {
  course: MapsCourse;
  className?: string;
  children?: ReactNode;
};

/** Opens Google Maps on desktop; on mobile/PWA offers Apple Maps or Google Maps. */
export function GetDirectionsButton({ course, className, children = 'Get directions →' }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          if (shouldOfferMapsChoice()) {
            setSheetOpen(true);
            return;
          }
          window.open(googleMapsDirectionsUrl(course), '_blank', 'noopener,noreferrer');
        }}
      >
        {children}
      </button>
      <DirectionsChoiceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} course={course} />
    </>
  );
}
