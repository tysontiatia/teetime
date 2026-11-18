import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { captureEvent } from '../lib/analytics';
import { coursePhotoUrl } from '../lib/coursePhotoUrl';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import {
  dismissBookingFollowUp,
  getBookingFollowUp,
  onBookingTabHidden,
  onBookingTabVisible,
  subscribeBookingFollowUp,
} from '../lib/bookingFollowUp';
import { useCourseCatalog, useFullRecords } from '../state/CourseCatalogContext';
import { CoursePhoto } from './CoursePhoto';

export function BookingFollowUp() {
  const prompt = useSyncExternalStore(subscribeBookingFollowUp, getBookingFollowUp, getBookingFollowUp);
  const { recordsBySlug } = useCourseCatalog();
  // Booking deep links need the course's full record; this loads it.
  useFullRecords(prompt?.courseId ? [prompt.courseId] : []);
  const titleId = useId();
  const [thanks, setThanks] = useState(false);
  useBodyScrollLock(Boolean(prompt));

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onBookingTabHidden();
      else onBookingTabVisible();
    };
    const onPageShow = () => onBookingTabVisible();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  useEffect(() => {
    if (!prompt) setThanks(false);
  }, [prompt]);

  useEffect(() => {
    if (!thanks) return;
    const timer = window.setTimeout(() => dismissBookingFollowUp(), 1400);
    return () => window.clearTimeout(timer);
  }, [thanks]);

  if (!prompt) return null;

  const record = recordsBySlug.get(prompt.courseId);
  const photo = record ? coursePhotoUrl(record) : undefined;

  const answer = (booked: boolean) => {
    captureEvent('booking_reported', {
      course: prompt.courseName,
      course_id: prompt.courseId,
      booked,
    });
    if (booked) setThanks(true);
    else dismissBookingFollowUp();
  };

  return (
    <div className="booking-followup-backdrop" role="presentation">
      <div
        className="booking-followup"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="booking-followup-photo">
          <CoursePhoto src={photo} alt="" height={176} loading="eager" />
        </div>
        <div className="booking-followup-body">
          <h2 id={titleId} className="booking-followup-q">
            {thanks ? 'Have a good round.' : `Did you book at ${prompt.courseName}?`}
          </h2>
          {thanks ? null : (
            <div className="booking-followup-actions">
              <button type="button" className="btn btn-primary" onClick={() => answer(true)}>
                Yes
              </button>
              <button type="button" className="btn" onClick={() => answer(false)}>
                Not this time
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
