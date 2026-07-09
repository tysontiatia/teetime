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

function vitalsLine(record: CourseRecord): string | null {
  const parts: string[] = [];
  if (record.holes) parts.push(`${record.holes} holes`);
  if (record.par) parts.push(`Par ${record.par}`);
  if (record.yardage) parts.push(`${record.yardage.toLocaleString()} yds`);
  const walk = walkabilityLabel(record.walkability);
  if (walk) parts.push(walk);
  return parts.length ? parts.join(' · ') : null;
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

type Props = {
  record: CourseRecord | undefined;
  rates: CourseRatesExpanded | null;
  catalogMeta: CourseCatalogMeta | null;
  ratesLoading: boolean;
};

export function CourseDetailPanel({ record, rates, catalogMeta, ratesLoading }: Props) {
  const vitals = record ? vitalsLine(record) : null;
  const booking = record ? bookingWindowLine(record) : null;
  const rateRows = rates && ratesExpandedHasPrices(rates) ? buildRateRows(rates) : [];
  const showNine = rateRows.some((r) => r.nine != null);
  const showEighteen = rateRows.some((r) => r.eighteen != null);

  const hasAbout =
    record?.editorial_note ||
    record?.history_blurb ||
    catalogMeta?.history_blurb ||
    catalogMeta?.signature_hole ||
    record?.signature_hole ||
    vitals ||
    booking ||
    record?.website ||
    record?.phone_number ||
    catalogMeta?.prepaid ||
    catalogMeta?.cancellation_policy ||
    record?.cancellation_policy;

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
          <h2>About</h2>
          {vitals ? <p className="about-vitals">{vitals}</p> : null}
          {booking ? <p className="about-booking">{booking}</p> : null}
          {catalogMeta?.prepaid ? (
            <div className="about-pill-row">
              <span className="pill about-prepaid">Prepaid at booking</span>
            </div>
          ) : null}
          {record?.editorial_note ? <p>{record.editorial_note}</p> : null}
          {catalogMeta?.signature_hole || record?.signature_hole ? (
            <p>
              <strong>Signature hole:</strong> {catalogMeta?.signature_hole ?? record?.signature_hole}
            </p>
          ) : null}
          {catalogMeta?.history_blurb || record?.history_blurb ? (
            <p className="about-history">{catalogMeta?.history_blurb ?? record?.history_blurb}</p>
          ) : null}
          {catalogMeta?.cancellation_policy || record?.cancellation_policy ? (
            <p className="about-cancel">
              <strong>Cancellation:</strong> {catalogMeta?.cancellation_policy ?? record?.cancellation_policy}
            </p>
          ) : null}
          {record?.website || record?.phone_number ? (
            <div className="about-contact">
              {record?.website ? (
                <a href={record.website} target="_blank" rel="noreferrer" className="detail-text-link">
                  Course website →
                </a>
              ) : null}
              {record?.phone_number ? (
                <a href={`tel:${record.phone_number.replace(/\D/g, '')}`} className="detail-text-link">
                  {record.phone_number}
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="section">
        <h2>Green fees</h2>
        <p className="rate-fine rate-fine-lead">Published green fees — not live tee-time prices.</p>
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
