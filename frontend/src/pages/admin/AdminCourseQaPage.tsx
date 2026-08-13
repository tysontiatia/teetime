import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CourseRecord } from '../../lib/courseRecord';
import {
  getAdminCourse,
  listAdminCourses,
  lookupPlacesDetails,
  parseBookingUrl,
  updateAdminCourse,
} from '../../lib/courseAdminApi';
import {
  ratesFromExpanded,
  ratesPayload,
  type AdminRatesForm,
} from '../../lib/adminCourseTypes';
import {
  applyParsedBookingUrl,
  BOOKING_STATUS_LABELS,
  externalHttpUrl,
  needsBookingRecord,
  type BookingStatus,
} from '../../lib/adminBookingQa';
import { capabilityHint, getPlatformCapability, platformDisplayName } from '../../lib/platformRegistry';

const PLATFORMS = [
  'foreup',
  'foreup_login',
  'chronogolf',
  'chronogolf_slc',
  'membersports',
  'teeitup',
  'trutee',
  'golfpay',
  'tenfore',
  'cps',
];

type Step = 1 | 2 | 3;
/** QA outcome chosen on step 2 (maps to booking_status on save). */
type QaOutcome = 'online' | 'phone' | 'unsupported' | 'private' | 'closed';

const OUTCOME_TO_STATUS: Record<QaOutcome, BookingStatus> = {
  online: 'ready',
  phone: 'phone',
  unsupported: 'unsupported',
  private: 'private',
  closed: 'closed',
};

export function AdminCourseQaPage() {
  const { slug: routeSlug } = useParams();
  const nav = useNavigate();

  const [queue, setQueue] = useState<string[]>([]);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [slug, setSlug] = useState(routeSlug || '');
  const [record, setRecord] = useState<CourseRecord | null>(null);
  const [prepaid, setPrepaid] = useState(false);
  const [rates, setRates] = useState<AdminRatesForm | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [outcome, setOutcome] = useState<QaOutcome>('online');
  const [bookingUrlInput, setBookingUrlInput] = useState('');
  const [statusNote, setStatusNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [enrichNote, setEnrichNote] = useState<string | null>(null);
  const [autoEnriched, setAutoEnriched] = useState(false);

  const refreshQueue = useCallback(async (preferSlug?: string) => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const courses = await listAdminCourses();
      const needs = courses.filter(needsBookingRecord).sort((a, b) => a.slug.localeCompare(b.slug));
      setQueueTotal(needs.length);
      const slugs = needs.map((c) => c.slug);
      setQueue(slugs);

      const preferred = preferSlug || routeSlug;
      if (preferred && slugs.includes(preferred)) {
        setSlug(preferred);
        if (preferred !== routeSlug) nav(`/admin/courses/qa/${preferred}`, { replace: true });
      } else if (slugs.length > 0) {
        const next = slugs[0]!;
        setSlug(next);
        if (next !== routeSlug) nav(`/admin/courses/qa/${next}`, { replace: true });
      } else {
        setSlug('');
        if (routeSlug) nav('/admin/courses/qa', { replace: true });
      }
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Failed to load queue');
    } finally {
      setQueueLoading(false);
    }
  }, [nav, routeSlug]);

  useEffect(() => {
    void refreshQueue(routeSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSlug]);

  useEffect(() => {
    if (!slug) {
      setRecord(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      setError(null);
      setWarnings([]);
      setEnrichNote(null);
      setAutoEnriched(false);
      setStep(1);
      setOutcome('online');
      setStatusNote('');
      try {
        const detail = await getAdminCourse(slug);
        if (cancelled) return;
        const rec = detail.record || {
          name: slug,
          area: '',
          platform: '',
          booking_url: '',
          booking_status: 'pending',
        };
        setRecord(rec);
        setBookingUrlInput(rec.booking_url || '');
        setStatusNote(rec.booking_status_note || '');
        setPrepaid(Boolean(detail.catalog?.prepaid));
        setRates(ratesFromExpanded(detail.rates));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load course');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const position = useMemo(() => {
    if (!slug || queue.length === 0) return 0;
    const i = queue.indexOf(slug);
    return i >= 0 ? i + 1 : 0;
  }, [queue, slug]);

  const websiteHref = externalHttpUrl(record?.website);
  const mapsHref = record?.google_place_id
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(record.google_place_id)}`
    : null;

  const patchRecord = (patch: Partial<CourseRecord>) => {
    setRecord((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const onEnrichWebsite = async () => {
    if (!record?.google_place_id) {
      setError('No google_place_id on this stub — paste a website manually or look up on the edit page.');
      setAutoEnriched(true);
      return;
    }
    setBusy(true);
    setError(null);
    setEnrichNote(null);
    setAutoEnriched(true);
    try {
      const place = await lookupPlacesDetails(record.google_place_id);
      patchRecord({
        website: place.website ?? record.website,
        phone_number: place.phone_number ?? record.phone_number,
        address: place.address ?? record.address,
        lat: place.lat ?? record.lat,
        lng: place.lng ?? record.lng,
        rating: place.rating ?? record.rating,
        review_count: place.review_count ?? record.review_count,
        photo_reference: place.photo_reference ?? record.photo_reference,
      });
      setEnrichNote(
        place.website
          ? 'Pulled website from Google Places Details.'
          : 'Places Details returned no website — search Google Maps / call the pro shop.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Places Details failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!record || loading || step !== 1 || autoEnriched || busy) return;
    if (record.website?.trim()) {
      setAutoEnriched(true);
      return;
    }
    if (!record.google_place_id?.trim()) {
      setAutoEnriched(true);
      return;
    }
    void onEnrichWebsite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.google_place_id, record?.website, loading, step]);

  const onParse = async () => {
    const url = bookingUrlInput.trim();
    if (!url || !record) return;
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const parsed = await parseBookingUrl(url);
      const next = applyParsedBookingUrl(record, parsed, url);
      setRecord(next);
      setBookingUrlInput(next.booking_url || url);
      setOutcome('online');
      if (!parsed.platform) {
        setWarnings(['Could not detect platform from URL — pick one manually, or mark Unsupported platform.']);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not parse booking URL');
    } finally {
      setBusy(false);
    }
  };

  const goNextInQueue = (doneSlug: string) => {
    const remaining = queue.filter((s) => s !== doneSlug);
    setQueue(remaining);
    setQueueTotal(remaining.length);
    if (remaining.length === 0) {
      setSlug('');
      setRecord(null);
      nav('/admin/courses/qa', { replace: true });
      return;
    }
    const idx = queue.indexOf(doneSlug);
    const next = remaining[Math.min(Math.max(idx, 0), remaining.length - 1)] || remaining[0]!;
    setSlug(next);
    nav(`/admin/courses/qa/${next}`, { replace: true });
  };

  const onSkip = () => {
    if (!slug || queue.length <= 1) return;
    const idx = queue.indexOf(slug);
    const next = queue[(idx + 1) % queue.length]!;
    setSlug(next);
    nav(`/admin/courses/qa/${next}`, { replace: true });
  };

  const canContinueFromBooking = (): boolean => {
    if (outcome === 'online') {
      return Boolean(bookingUrlInput.trim() && record?.platform?.trim() && record.platform !== 'other');
    }
    if (outcome === 'unsupported') {
      return Boolean(bookingUrlInput.trim() && statusNote.trim());
    }
    if (outcome === 'phone') {
      return true;
    }
    if (outcome === 'private' || outcome === 'closed') {
      return true;
    }
    return false;
  };

  const buildSaveRecord = (): CourseRecord | null => {
    if (!record) return null;
    const status = OUTCOME_TO_STATUS[outcome];
    const note = statusNote.trim();
    if (outcome === 'online') {
      const booking = bookingUrlInput.trim() || record.booking_url;
      return {
        ...record,
        booking_url: booking,
        booking_status: status,
        booking_status_note: note || undefined,
      };
    }
    if (outcome === 'phone') {
      return {
        ...record,
        platform: '',
        booking_url: '',
        booking_status: status,
        booking_status_note: note || undefined,
      };
    }
    if (outcome === 'unsupported') {
      const booking = bookingUrlInput.trim() || record.booking_url;
      if (!booking) return null;
      return {
        ...record,
        platform: 'other',
        booking_url: booking,
        booking_status: status,
        booking_status_note: note || 'unknown',
      };
    }
    // private / closed — keep contact info; clear live booking fields for private
    if (outcome === 'private') {
      return {
        ...record,
        platform: '',
        booking_url: '',
        booking_status: status,
        booking_status_note: note || undefined,
      };
    }
    return {
      ...record,
      booking_status: status,
      booking_status_note: note || undefined,
    };
  };

  const onSaveAndNext = async () => {
    if (!record || !slug || !rates) return;
    if (!canContinueFromBooking()) {
      setError('Fill the required fields for this outcome before saving.');
      setStep(2);
      return;
    }
    if (outcome === 'phone' && !record.phone_number?.trim()) {
      setWarnings(['No phone on file — consider adding one on Full edit after this save.']);
    }
    const toSave = buildSaveRecord();
    if (!toSave) return;
    setBusy(true);
    setError(null);
    try {
      const result = await updateAdminCourse(slug, {
        record: toSave,
        prepaid,
        rates: ratesPayload(rates),
      });
      setWarnings(result.platform_warnings || []);
      goNextInQueue(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const outcomeChip = (id: QaOutcome, label: string) => (
    <button
      key={id}
      type="button"
      className="btn"
      style={{
        fontWeight: outcome === id ? 800 : 500,
        borderColor: outcome === id ? 'var(--pine)' : undefined,
        opacity: outcome === id ? 1 : 0.75,
      }}
      disabled={busy}
      onClick={() => {
        setOutcome(id);
        setError(null);
      }}
    >
      {label}
    </button>
  );

  if (queueLoading && !record) {
    return (
      <div className="container" style={{ paddingBottom: 40, marginTop: 8 }}>
        <Link to="/admin/courses" className="pill">
          ← Back to courses
        </Link>
        <p style={{ marginTop: 16, color: 'var(--muted)' }}>Loading Needs booking queue…</p>
      </div>
    );
  }

  if (queueError) {
    return (
      <div className="container" style={{ paddingBottom: 40, marginTop: 8 }}>
        <Link to="/admin/courses" className="pill">
          ← Back to courses
        </Link>
        <p className="admin-err" style={{ marginTop: 16 }}>{queueError}</p>
      </div>
    );
  }

  if (!slug || queueTotal === 0) {
    return (
      <div className="container" style={{ paddingBottom: 40, marginTop: 8 }}>
        <Link to="/admin/courses" className="pill">
          ← Back to courses
        </Link>
        <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.03em' }}>
          Booking QA
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          Queue is empty — every course has a booking disposition (ready, phone, unsupported, private, or closed).
        </p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBottom: 48, maxWidth: 720 }}>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <Link to="/admin/courses" className="pill">
            ← Back to courses
          </Link>
          <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: '-0.03em' }}>
            Booking QA
          </h1>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            {position} / {queueTotal} need booking
            {slug ? (
              <>
                {' '}
                · <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{slug}</span>
              </>
            ) : null}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" to={`/admin/courses/${slug}`}>
            Full edit
          </Link>
          <button type="button" className="btn" disabled={busy} onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {([1, 2, 3] as Step[]).map((s) => (
          <button
            key={s}
            type="button"
            className="btn"
            style={{
              opacity: step === s ? 1 : 0.65,
              fontWeight: step === s ? 800 : 500,
              borderColor: step === s ? 'var(--pine)' : undefined,
            }}
            onClick={() => setStep(s)}
            disabled={busy || loading}
          >
            {s === 1 ? '1 · Website' : s === 2 ? '2 · Disposition' : '3 · Save'}
          </button>
        ))}
      </div>

      {loading || !record ? (
        <p style={{ marginTop: 20, color: 'var(--muted)' }}>Loading course…</p>
      ) : loadError ? (
        <p className="admin-err" style={{ marginTop: 20 }}>{loadError}</p>
      ) : (
        <div
          style={{
            marginTop: 16,
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: 20,
            background: 'var(--card)',
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20, letterSpacing: '-0.02em' }}>{record.name}</div>
          {record.area ? <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>{record.area}</div> : null}
          {record.address ? <div style={{ color: 'var(--subtle)', fontSize: 13, marginTop: 6 }}>{record.address}</div> : null}
          {record.phone_number ? (
            <div style={{ marginTop: 6, fontSize: 13 }}>
              <a href={`tel:${record.phone_number.replace(/[^\d+]/g, '')}`}>{record.phone_number}</a>
            </div>
          ) : null}

          {error ? <p className="admin-err" style={{ marginTop: 12 }}>{error}</p> : null}
          {enrichNote ? <p style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>{enrichNote}</p> : null}
          {warnings.length > 0 ? (
            <ul style={{ marginTop: 12, paddingLeft: 18, color: 'var(--muted)', fontSize: 13 }}>
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}

          {step === 1 ? (
            <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                Confirm the marketing website (not the tee-sheet URL). Use it to find the Book / Tee Times link next.
              </p>
              <label style={{ display: 'block' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Website</div>
                <input
                  className="input"
                  value={record.website || ''}
                  onChange={(e) => patchRecord({ website: e.target.value })}
                  placeholder="https://…"
                  style={{ width: '100%' }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !record.google_place_id}
                  onClick={() => void onEnrichWebsite()}
                >
                  {busy ? 'Enriching…' : 'Enrich from Place ID'}
                </button>
                {websiteHref ? (
                  <a className="btn btn-primary" href={websiteHref} target="_blank" rel="noreferrer">
                    Open website
                  </a>
                ) : null}
                {mapsHref ? (
                  <a className="btn" href={mapsHref} target="_blank" rel="noreferrer">
                    Google Maps
                  </a>
                ) : null}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => setStep(2)}>
                  Continue →
                </button>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                How should golfers book this course?
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {outcomeChip('online', 'Online booking')}
                {outcomeChip('phone', 'Phone / in-person')}
                {outcomeChip('unsupported', 'Unsupported platform')}
                {outcomeChip('private', 'Private / members-only')}
                {outcomeChip('closed', 'Closed')}
              </div>

              {websiteHref ? (
                <a href={websiteHref} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  Open course website ↗
                </a>
              ) : null}

              {outcome === 'online' || outcome === 'unsupported' ? (
                <>
                  <label style={{ display: 'block' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
                      {outcome === 'unsupported' ? 'Booking URL (required — kept for platform backlog)' : 'Booking URL'}
                    </div>
                    <input
                      className="input"
                      value={bookingUrlInput}
                      onChange={(e) => setBookingUrlInput(e.target.value)}
                      placeholder="https://…"
                      style={{ width: '100%' }}
                    />
                  </label>
                  {outcome === 'online' ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy || !bookingUrlInput.trim()}
                        onClick={() => void onParse()}
                      >
                        {busy ? 'Parsing…' : 'Parse URL'}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}

              {outcome === 'online' ? (
                <label style={{ display: 'block' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>Platform</div>
                  <select
                    className="input"
                    value={record.platform || ''}
                    onChange={(e) => patchRecord({ platform: e.target.value })}
                    style={{ width: '100%', maxWidth: 320 }}
                  >
                    <option value="">Select…</option>
                    {PLATFORMS.map((p) => (
                      <option key={p} value={p}>
                        {platformDisplayName(p)}
                      </option>
                    ))}
                  </select>
                  {record.platform ? (
                    <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>
                      {capabilityHint(getPlatformCapability(record.platform))}
                    </div>
                  ) : null}
                </label>
              ) : null}

              {outcome === 'unsupported' ? (
                <>
                  <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                    Save the real book/tee-sheet URL plus the vendor name. We keep both for a later “which platforms to
                    build” backlog — the course can still show as a booking link in Find.
                  </p>
                  <label style={{ display: 'block' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
                      Vendor name (required)
                    </div>
                    <input
                      className="input"
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="e.g. GolfNow, EZLinks, Chronogolf private…"
                      style={{ width: '100%', maxWidth: 420 }}
                    />
                  </label>
                </>
              ) : null}

              {outcome === 'phone' ? (
                <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                  Saves as phone / in-person only. Course can still appear in Find with call / website CTAs — no tee-sheet poll.
                  {!record.phone_number?.trim() ? ' Tip: add a phone on Full edit if missing.' : ''}
                </p>
              ) : null}

              {outcome === 'private' ? (
                <label style={{ display: 'block' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
                    Note (optional)
                  </div>
                  <input
                    className="input"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="e.g. Private country club — members only"
                    style={{ width: '100%', maxWidth: 420 }}
                  />
                  <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>
                    Private courses stay in the admin catalog but are hidden from public Find and not polled.
                  </div>
                </label>
              ) : null}

              {outcome === 'closed' ? (
                <label style={{ display: 'block' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
                    Note (optional)
                  </div>
                  <input
                    className="input"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="e.g. Permanently closed 2024"
                    style={{ width: '100%', maxWidth: 420 }}
                  />
                  <div style={{ fontSize: 12, color: 'var(--subtle)', marginTop: 4 }}>
                    Closed courses are hidden from public Find and skipped by the poller.
                  </div>
                </label>
              ) : null}

              {(outcome === 'online' || outcome === 'phone') && (
                <label style={{ display: 'block' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
                    Note (optional)
                  </div>
                  <input
                    className="input"
                    value={statusNote}
                    onChange={(e) => setStatusNote(e.target.value)}
                    placeholder="Optional QA note"
                    style={{ width: '100%', maxWidth: 420 }}
                  />
                </label>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => setStep(1)}>
                  ← Website
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !canContinueFromBooking()}
                  onClick={() => setStep(3)}
                >
                  Review & save →
                </button>
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div style={{ marginTop: 20, display: 'grid', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                Confirm and save. This course leaves Needs booking, then we load the next stub.
              </p>
              <dl style={{ margin: 0, display: 'grid', gap: 8, fontSize: 14 }}>
                <div>
                  <dt style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Disposition</dt>
                  <dd style={{ margin: '2px 0 0' }}>{BOOKING_STATUS_LABELS[OUTCOME_TO_STATUS[outcome]]}</dd>
                </div>
                <div>
                  <dt style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Website</dt>
                  <dd style={{ margin: '2px 0 0' }}>{record.website || '—'}</dd>
                </div>
                {outcome === 'online' || outcome === 'unsupported' ? (
                  <>
                    <div>
                      <dt style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Platform</dt>
                      <dd style={{ margin: '2px 0 0' }}>
                        {outcome === 'unsupported'
                          ? 'Other / unsupported'
                          : platformDisplayName(record.platform || undefined)}
                      </dd>
                    </div>
                    <div>
                      <dt style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Booking URL</dt>
                      <dd style={{ margin: '2px 0 0', wordBreak: 'break-all' }}>
                        {bookingUrlInput.trim() || record.booking_url || '—'}
                      </dd>
                    </div>
                  </>
                ) : null}
                {statusNote.trim() ? (
                  <div>
                    <dt style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>Note</dt>
                    <dd style={{ margin: '2px 0 0' }}>{statusNote.trim()}</dd>
                  </div>
                ) : null}
              </dl>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button type="button" className="btn" disabled={busy} onClick={() => setStep(2)}>
                  ← Disposition
                </button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSaveAndNext()}>
                  {busy ? 'Saving…' : 'Save & next'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
