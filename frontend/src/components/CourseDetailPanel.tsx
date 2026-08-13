import type { ReactNode } from 'react';
import type { CourseRecord } from '../lib/courseRecord';
import type { CourseCatalogMeta } from '../lib/courseCatalogApi';
import type { MapsCourse } from '../lib/mapsLinks';
import { GetDirectionsButton } from './GetDirectionsButton';

function walkabilityLabel(v: CourseRecord['walkability']): string | null {
  if (!v) return null;
  if (v === 'carts only') return 'Carts only';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function bookingWindowLine(record: CourseRecord): string | null {
  const days = record.booking_window_days;
  if (!Number.isFinite(days)) return null;
  const opens = record.booking_opens_time?.trim();
  if (opens) return `Books ${days} days out · opens ${opens} MT`;
  return `Books ${days} days out`;
}

type InfoRow = { label: string; value: ReactNode };

type Props = {
  record: CourseRecord | undefined;
  catalogMeta: CourseCatalogMeta | null;
  course: MapsCourse;
};

export function CourseDetailPanel({ record, catalogMeta, course }: Props) {
  const booking = record ? bookingWindowLine(record) : null;
  const walk = record ? walkabilityLabel(record.walkability) : null;

  const aboutCopy =
    record?.editorial_note || catalogMeta?.history_blurb || record?.history_blurb || null;

  const infoRows: InfoRow[] = [];
  if (record?.address) {
    infoRows.push({
      label: 'Address',
      value: (
        <span className="course-info-address">
          <span>{record.address}</span>
          <GetDirectionsButton course={course} className="detail-text-link detail-text-link--btn" />
        </span>
      ),
    });
  } else {
    infoRows.push({
      label: 'Directions',
      value: (
        <GetDirectionsButton course={course} className="detail-text-link detail-text-link--btn" />
      ),
    });
  }
  if (record?.phone_number) {
    infoRows.push({
      label: 'Phone',
      value: (
        <a href={`tel:${record.phone_number.replace(/\D/g, '')}`} className="detail-text-link">
          {record.phone_number}
        </a>
      ),
    });
  }
  if (record?.website) {
    infoRows.push({
      label: 'Website',
      value: (
        <a href={record.website} target="_blank" rel="noreferrer" className="detail-text-link">
          Course site →
        </a>
      ),
    });
  }
  if (walk) infoRows.push({ label: 'Walkability', value: walk });
  if (booking) infoRows.push({ label: 'Booking window', value: booking });
  if (catalogMeta?.prepaid) infoRows.push({ label: 'Payment', value: 'Prepaid at booking' });
  if (catalogMeta?.cancellation_policy || record?.cancellation_policy) {
    infoRows.push({
      label: 'Cancellation',
      value: catalogMeta?.cancellation_policy ?? record?.cancellation_policy,
    });
  }
  if (catalogMeta?.signature_hole || record?.signature_hole) {
    infoRows.push({
      label: 'Signature hole',
      value: catalogMeta?.signature_hole ?? record?.signature_hole,
    });
  }

  const hasAbout = Boolean(aboutCopy || infoRows.length > 0);

  if (!hasAbout) {
    return (
      <div className="section">
        <p className="section-muted">Course details coming soon.</p>
      </div>
    );
  }

  return (
    <div className="section">
      <h2>About this course</h2>
      {aboutCopy ? <p className="about-lead">{aboutCopy}</p> : null}
      {infoRows.length > 0 ? (
        <dl className="course-info-grid">
          {infoRows.map((row) => (
            <div key={row.label} className="course-info-item">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
