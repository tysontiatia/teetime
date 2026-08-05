import type { ReactNode } from 'react';
import type { CourseRecord } from '../lib/courseRecord';
import {
  formatRateDollars,
  ratesExpandedHasPrices,
  type CourseCatalogMeta,
  type CourseRatesExpanded,
} from '../lib/courseCatalogApi';

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

type RateRow = {
  label: string;
  nine: number | null | undefined;
  eighteen: number | null | undefined;
};

function buildRateRows(rates: CourseRatesExpanded): RateRow[] {
  const rows: RateRow[] = [
    {
      label: 'Weekday walk',
      nine: rates.rate_weekday_walk_9,
      eighteen: rates.rate_weekday_walk_18,
    },
    {
      label: 'Weekend walk',
      nine: rates.rate_weekend_walk_9,
      eighteen: rates.rate_weekend_walk_18,
    },
    {
      label: 'Weekday w/ cart',
      nine: rates.rate_weekday_cart_9,
      eighteen: rates.rate_weekday_cart_18,
    },
    {
      label: 'Weekend w/ cart',
      nine: rates.rate_weekend_cart_9,
      eighteen: rates.rate_weekend_cart_18,
    },
  ];
  return rows.filter((r) => r.nine != null || r.eighteen != null);
}

type InfoRow = { label: string; value: ReactNode };

type Props = {
  record: CourseRecord | undefined;
  rates: CourseRatesExpanded | null;
  catalogMeta: CourseCatalogMeta | null;
  ratesLoading: boolean;
};

export function CourseDetailPanel({ record, rates, catalogMeta, ratesLoading }: Props) {
  const booking = record ? bookingWindowLine(record) : null;
  const walk = record ? walkabilityLabel(record.walkability) : null;
  const rateRows = rates && ratesExpandedHasPrices(rates) ? buildRateRows(rates) : [];
  const showNine = rateRows.some((r) => r.nine != null);
  const showEighteen = rateRows.some((r) => r.eighteen != null);

  const aboutCopy =
    record?.editorial_note || catalogMeta?.history_blurb || record?.history_blurb || null;

  const infoRows: InfoRow[] = [];
  if (record?.address) infoRows.push({ label: 'Address', value: record.address });
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

  const hasAbout = aboutCopy || infoRows.length > 0;

  if (!record && !ratesLoading && !rateRows.length) {
    return (
      <div className="section">
        <p className="section-muted">Course details coming soon.</p>
      </div>
    );
  }

  return (
    <>
      {hasAbout ? (
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
      ) : null}

      <div className="section">
        <h2>Green fees</h2>
        <p className="rate-fine rate-fine-lead">Published green fees, not live tee-time prices.</p>
        {ratesLoading ? (
          <p className="section-muted">Loading rates…</p>
        ) : rateRows.length === 0 ? (
          <p className="section-muted">Rates not cataloged yet.</p>
        ) : (
          <table className="rate-table">
            <thead>
              <tr>
                <th>Rate</th>
                {showNine ? <th className="num">9 holes</th> : null}
                {showEighteen ? <th className="num">18 holes</th> : null}
              </tr>
            </thead>
            <tbody>
              {rateRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  {showNine ? <td className="num">{formatRateDollars(row.nine)}</td> : null}
                  {showEighteen ? <td className="num">{formatRateDollars(row.eighteen)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {record?.rate_notes ? <p className="rate-fine" style={{ whiteSpace: 'pre-wrap' }}>{record.rate_notes}</p> : null}
      </div>
    </>
  );
}
