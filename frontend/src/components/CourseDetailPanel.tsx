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
    record?.signature_hole;

  const hasContact = record?.website || record?.phone_number;

  if (!record && !ratesLoading && !rateRows.length) {
    return (
      <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
        <div style={{ color: 'var(--muted)', fontSize: 14 }}>Course details coming soon.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
        <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>About this course</div>

        {vitals ? (
          <div style={{ marginTop: 8, fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{vitals}</div>
        ) : null}

        {booking ? (
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--muted)' }}>{booking}</div>
        ) : null}

        {catalogMeta?.prepaid ? (
          <div style={{ marginTop: 10 }}>
            <span className="pill" style={{ color: '#9a3412', borderColor: 'rgba(180,83,9,0.35)' }}>
              Prepaid at booking
            </span>
          </div>
        ) : null}

        {hasContact ? (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            {record?.website ? (
              <a href={record.website} target="_blank" rel="noreferrer" style={{ color: 'var(--green-2)', fontWeight: 700 }}>
                Course website →
              </a>
            ) : null}
            {record?.phone_number ? (
              <a href={`tel:${record.phone_number.replace(/\D/g, '')}`} style={{ color: 'var(--green-2)', fontWeight: 700 }}>
                {record.phone_number}
              </a>
            ) : null}
          </div>
        ) : null}

        {hasAbout ? (
          <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: 'var(--ink)' }}>
            {record?.editorial_note ? <p style={{ margin: '0 0 10px' }}>{record.editorial_note}</p> : null}
            {(catalogMeta?.signature_hole || record?.signature_hole) ? (
              <p style={{ margin: '0 0 10px', color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--ink)' }}>Signature hole:</strong>{' '}
                {catalogMeta?.signature_hole ?? record?.signature_hole}
              </p>
            ) : null}
            {(catalogMeta?.history_blurb || record?.history_blurb) ? (
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                {catalogMeta?.history_blurb ?? record?.history_blurb}
              </p>
            ) : null}
          </div>
        ) : null}

        {(catalogMeta?.cancellation_policy || record?.cancellation_policy) ? (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--ink)' }}>Cancellation:</strong>{' '}
            {catalogMeta?.cancellation_policy ?? record?.cancellation_policy}
          </p>
        ) : null}
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
        <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>Rate card</div>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Published green fees (not live tee-time prices). Seasonal or resident splits may not appear here yet.
        </p>

        {ratesLoading ? (
          <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 14 }}>Loading rates…</div>
        ) : rateRows.length === 0 ? (
          <div style={{ marginTop: 12, color: 'var(--muted)', fontSize: 14 }}>Rates not cataloged yet.</div>
        ) : (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <th style={{ padding: '6px 8px 6px 0', fontWeight: 700 }} />
                  {showNine ? <th style={{ padding: '6px 8px', fontWeight: 700 }}>9 holes</th> : null}
                  {showEighteen ? <th style={{ padding: '6px 0 6px 8px', fontWeight: 700 }}>18 holes</th> : null}
                </tr>
              </thead>
              <tbody>
                {rateRows.map((row) => (
                  <tr key={row.label} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 8px 8px 0', fontWeight: 600 }}>{row.label}</td>
                    {showNine ? (
                      <td style={{ padding: '8px', fontWeight: 800, color: 'var(--green-2)' }}>
                        {formatRateDollars(row.nine)}
                      </td>
                    ) : null}
                    {showEighteen ? (
                      <td style={{ padding: '8px 0 8px 8px', fontWeight: 800, color: 'var(--green-2)' }}>
                        {formatRateDollars(row.eighteen)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {record?.rate_notes ? (
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 12, color: 'var(--muted)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {record.rate_notes}
          </p>
        ) : null}
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
        <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>Shared rounds</div>
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--muted)', lineHeight: 1.6, fontSize: 14 }}>
          <li>
            <strong>Share times</strong> puts every filtered tee time into a vote link for your group.
          </li>
          <li>Check the weather strip for conditions that day.</li>
          <li>Everyone opens the same link to vote; one person books when the group agrees.</li>
        </ul>
      </div>
    </div>
  );
}
