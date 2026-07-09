import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CourseRecord } from '../../lib/courseRecord';
import { slugFromCourseName } from '../../lib/courseSlug';
import {
  createAdminCourse,
  getAdminCourse,
  lookupPlaces,
  parseBookingUrl,
  updateAdminCourse,
} from '../../lib/courseAdminApi';
import {
  EMPTY_RATES,
  emptyCourseRecord,
  ratesFromExpanded,
  ratesPayload,
  type AdminRatesForm,
} from '../../lib/adminCourseTypes';
import { capabilityHint, getPlatformCapability, platformDisplayName } from '../../lib/platformRegistry';

const PLATFORMS = [
  'foreup',
  'foreup_login',
  'chronogolf',
  'chronogolf_slc',
  'membersports',
  'trutee',
  'golfpay',
  'tenfore',
];

const WALKABILITY = ['flat', 'moderate', 'hilly', 'carts only'] as const;

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {children}
      {hint ? <div style={{ fontSize: 11, color: 'var(--subtle)', marginTop: 4 }}>{hint}</div> : null}
    </label>
  );
}

function section(title: string) {
  return (
    <div style={{ fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 12, marginTop: 4, fontSize: 16 }}>{title}</div>
  );
}

export function AdminCourseEditPage() {
  const { slug: routeSlug } = useParams();
  const isNew = routeSlug === 'new';
  const nav = useNavigate();

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [record, setRecord] = useState<CourseRecord>(() => emptyCourseRecord());
  const [prepaid, setPrepaid] = useState(false);
  const [rates, setRates] = useState<AdminRatesForm>({ ...EMPTY_RATES });
  const [placesQuery, setPlacesQuery] = useState('');
  const [bookingUrlInput, setBookingUrlInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  const slug = isNew ? slugFromCourseName(record.name) : routeSlug || '';

  useEffect(() => {
    if (isNew || !routeSlug) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await getAdminCourse(routeSlug);
        if (cancelled) return;
        if (data.record) {
          setRecord(data.record);
          setBookingUrlInput(data.record.booking_url || '');
        } else if (data.catalog) {
          const c = data.catalog;
          setRecord((prev) => ({
            ...prev,
            name: String(c.name || prev.name),
            holes: c.holes === 9 || c.holes === 18 ? c.holes : prev.holes,
            par: typeof c.par === 'number' ? c.par : prev.par,
            yardage: typeof c.yardage === 'number' ? c.yardage : prev.yardage,
            walkability: (c.walkability as CourseRecord['walkability']) || prev.walkability,
            editorial_note: String(c.editorial_note || '') || prev.editorial_note,
          }));
        }
        setPrepaid(Boolean(data.catalog?.prepaid));
        setRates(ratesFromExpanded(data.rates));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, routeSlug]);

  const platformCap = getPlatformCapability(record.platform);
  const capHint = capabilityHint(platformCap);

  const patchRecord = useCallback((patch: Partial<CourseRecord>) => {
    setRecord((prev) => ({ ...prev, ...patch }));
  }, []);

  const onPlacesLookup = async () => {
    const q = placesQuery.trim() || `${record.name} golf course`;
    setBusy(true);
    setSaveError(null);
    try {
      const place = await lookupPlaces(q, record.lat, record.lng);
      patchRecord({
        address: place.address ?? record.address,
        lat: place.lat ?? record.lat,
        lng: place.lng ?? record.lng,
        rating: place.rating ?? record.rating,
        review_count: place.review_count ?? record.review_count,
        website: place.website ?? record.website,
        phone_number: place.phone_number ?? record.phone_number,
        photo_reference: place.photo_reference ?? record.photo_reference,
      });
      if (isNew && place.name && !record.name) patchRecord({ name: place.name });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Places lookup failed');
    } finally {
      setBusy(false);
    }
  };

  const onParseBookingUrl = async () => {
    const url = bookingUrlInput.trim();
    if (!url) return;
    setBusy(true);
    setSaveError(null);
    try {
      const parsed = await parseBookingUrl(url);
      const hints = parsed.hints || {};
      const patch: Partial<CourseRecord> = { booking_url: parsed.booking_url || url };
      if (parsed.platform) patch.platform = parsed.platform;
      if (hints.schedule_id) patch.schedule_id = hints.schedule_id;
      if (hints.booking_class_id) patch.booking_class_id = hints.booking_class_id;
      if (hints.club_id) patch.club_id = hints.club_id;
      if (hints.course_id) patch.course_id = hints.course_id;
      if (hints.trutee_org_slug) patch.trutee_org_slug = hints.trutee_org_slug;
      if (hints.trutee_course_id) patch.trutee_course_id = hints.trutee_course_id;
      patchRecord(patch);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not parse booking URL');
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!record.name.trim()) {
      setSaveError('Course name is required');
      return;
    }
    if (!slug) {
      setSaveError('Could not derive slug from name');
      return;
    }
    setBusy(true);
    setSaveError(null);
    setWarnings([]);
    try {
      const payload = {
        record: { ...record, booking_url: bookingUrlInput.trim() || record.booking_url },
        prepaid,
        rates: ratesPayload(rates),
      };
      const result = isNew
        ? await createAdminCourse({ ...payload, slug })
        : await updateAdminCourse(slug, payload);
      setWarnings(result.platform_warnings || []);
      setSavedSlug(result.slug);
      if (isNew) {
        nav(`/admin/courses/${result.slug}`, { replace: true });
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const rateFields = useMemo(
    () =>
      [
        ['Weekday walk 9', 'rate_weekday_walk_9'],
        ['Weekday walk 18', 'rate_weekday_walk_18'],
        ['Weekend walk 9', 'rate_weekend_walk_9'],
        ['Weekend walk 18', 'rate_weekend_walk_18'],
        ['Weekday w/ cart 9', 'rate_weekday_cart_9'],
        ['Weekday w/ cart 18', 'rate_weekday_cart_18'],
        ['Weekend w/ cart 9', 'rate_weekend_cart_9'],
        ['Weekend w/ cart 18', 'rate_weekend_cart_18'],
      ] as const,
    [],
  );

  if (loading) {
    return (
      <div className="container" style={{ padding: 24, color: 'var(--muted)' }}>
        Loading course…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="container" style={{ padding: 24 }}>
        <p style={{ color: '#9a3412' }}>{loadError}</p>
        <Link className="btn" to="/admin/courses">
          Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBottom: 48 }}>
      <Link to="/admin/courses" className="pill">
        ← All courses
      </Link>
      <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 30, letterSpacing: '-0.03em' }}>
        {isNew ? 'Add course' : `Edit: ${record.name}`}
      </h1>
      {!isNew && slug ? (
        <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
          Slug: <strong style={{ color: 'var(--ink)' }}>{slug}</strong>
          {' · '}
          <Link to={`/course/${slug}`} target="_blank" rel="noreferrer" style={{ color: 'var(--green-2)', fontWeight: 700 }}>
            Preview detail page →
          </Link>
        </p>
      ) : (
        <p style={{ margin: '0 0 8px', color: 'var(--muted)', fontSize: 13 }}>
          Slug preview: <strong>{slug || '—'}</strong>
        </p>
      )}

      {savedSlug && !saveError ? (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 12,
            border: '1px solid rgba(45,122,58,0.35)',
            background: 'var(--green-soft)',
            color: 'var(--green)',
            fontSize: 14,
          }}
        >
          Saved <strong>{savedSlug}</strong>. Changes are live for apps reading the course registry.
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: '#92400e', fontSize: 13 }}>
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {saveError ? (
        <p style={{ marginTop: 12, color: '#9a3412', fontSize: 14 }}>
          {saveError}
        </p>
      ) : null}

      <div
        style={{
          marginTop: 16,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 16, background: '#fff' }}>
          {section('Identity')}
          <Field label="Course name (include city in parentheses)">
            <input
              className="input"
              value={record.name}
              onChange={(e) => patchRecord({ name: e.target.value })}
              placeholder="Glendale (SLC)"
            />
          </Field>
          <Field label="Area / region">
            <input
              className="input"
              value={record.area}
              onChange={(e) => patchRecord({ area: e.target.value })}
              placeholder="SALT LAKE CITY AREA"
            />
          </Field>
          <Field label="Google Places lookup" hint="Prefills address, phone, rating, coordinates">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                value={placesQuery}
                onChange={(e) => setPlacesQuery(e.target.value)}
                placeholder={record.name ? `${record.name} golf course` : 'Course name + state'}
              />
              <button type="button" className="btn" disabled={busy} onClick={() => void onPlacesLookup()}>
                Look up
              </button>
            </div>
          </Field>
          <Field label="Website">
            <input className="input" value={record.website || ''} onChange={(e) => patchRecord({ website: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input
              className="input"
              value={record.phone_number || ''}
              onChange={(e) => patchRecord({ phone_number: e.target.value })}
            />
          </Field>
          <Field label="Address">
            <input className="input" value={record.address || ''} onChange={(e) => patchRecord({ address: e.target.value })} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Latitude">
              <input
                className="input"
                type="number"
                step="any"
                value={record.lat ?? ''}
                onChange={(e) => patchRecord({ lat: e.target.value ? Number(e.target.value) : undefined })}
              />
            </Field>
            <Field label="Longitude">
              <input
                className="input"
                type="number"
                step="any"
                value={record.lng ?? ''}
                onChange={(e) => patchRecord({ lng: e.target.value ? Number(e.target.value) : undefined })}
              />
            </Field>
          </div>
          <Field label="Timezone">
            <input
              className="input"
              value={record.timezone || 'America/Denver'}
              onChange={(e) => patchRecord({ timezone: e.target.value })}
            />
          </Field>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 16, background: '#fff' }}>
          {section('Booking platform')}
          <Field label="Booking URL" hint="Paste from course site or Google — then Parse">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ flex: '1 1 200px' }}
                value={bookingUrlInput}
                onChange={(e) => setBookingUrlInput(e.target.value)}
                placeholder="https://…"
              />
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onParseBookingUrl()}>
                Parse URL
              </button>
            </div>
          </Field>
          <Field label="Platform">
            <select
              className="input"
              value={record.platform}
              onChange={(e) => patchRecord({ platform: e.target.value })}
            >
              <option value="">— select —</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformDisplayName(p)}
                </option>
              ))}
            </select>
          </Field>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
            {platformDisplayName(record.platform)} — {capHint}
          </p>

          {(record.platform === 'foreup' || record.platform === 'foreup_login') && (
            <>
              <Field label="schedule_id">
                <input className="input" value={record.schedule_id || ''} onChange={(e) => patchRecord({ schedule_id: e.target.value })} />
              </Field>
              <Field label="booking_class_id (optional)">
                <input
                  className="input"
                  value={record.booking_class_id || ''}
                  onChange={(e) => patchRecord({ booking_class_id: e.target.value })}
                />
              </Field>
            </>
          )}

          {(record.platform === 'chronogolf' || record.platform === 'chronogolf_slc') && (
            <>
              <Field label="club_id">
                <input className="input" value={record.club_id || ''} onChange={(e) => patchRecord({ club_id: e.target.value })} />
              </Field>
              <Field label="course_id">
                <input className="input" value={record.course_id || ''} onChange={(e) => patchRecord({ course_id: e.target.value })} />
              </Field>
              {record.platform === 'chronogolf_slc' && (
                <Field label="affiliation_type_id">
                  <input
                    className="input"
                    value={record.affiliation_type_id || ''}
                    onChange={(e) => patchRecord({ affiliation_type_id: e.target.value })}
                  />
                </Field>
              )}
            </>
          )}

          {record.platform === 'membersports' && (
            <>
              <Field label="golf_club_id">
                <input
                  className="input"
                  value={record.golf_club_id || ''}
                  onChange={(e) => patchRecord({ golf_club_id: e.target.value })}
                />
              </Field>
              <Field label="golf_course_id">
                <input
                  className="input"
                  value={record.golf_course_id || ''}
                  onChange={(e) => patchRecord({ golf_course_id: e.target.value })}
                />
              </Field>
            </>
          )}

          {record.platform === 'trutee' && (
            <>
              <Field label="trutee_org_slug">
                <input
                  className="input"
                  value={record.trutee_org_slug || ''}
                  onChange={(e) => patchRecord({ trutee_org_slug: e.target.value })}
                />
              </Field>
              <Field label="trutee_course_id">
                <input
                  className="input"
                  value={record.trutee_course_id || ''}
                  onChange={(e) => patchRecord({ trutee_course_id: e.target.value })}
                />
              </Field>
            </>
          )}

          <Field label="Booking URL template (optional)">
            <input
              className="input"
              value={record.booking_url_template || ''}
              onChange={(e) => patchRecord({ booking_url_template: e.target.value })}
            />
          </Field>
          <Field label="Poll tier">
            <select
              className="input"
              value={record.poll_tier || ''}
              onChange={(e) => patchRecord({ poll_tier: e.target.value as CourseRecord['poll_tier'] })}
            >
              <option value="">default</option>
              <option value="hot">hot</option>
              <option value="warm">warm</option>
              <option value="cold">cold</option>
            </select>
          </Field>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 16, background: '#fff' }}>
          {section('Course facts')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Field label="Holes">
              <select
                className="input"
                value={record.holes ?? ''}
                onChange={(e) => patchRecord({ holes: e.target.value ? (Number(e.target.value) as 9 | 18) : undefined })}
              >
                <option value="">—</option>
                <option value="9">9</option>
                <option value="18">18</option>
              </select>
            </Field>
            <Field label="Par">
              <input
                className="input"
                type="number"
                value={record.par ?? ''}
                onChange={(e) => patchRecord({ par: e.target.value ? Number(e.target.value) : undefined })}
              />
            </Field>
            <Field label="Yardage">
              <input
                className="input"
                type="number"
                value={record.yardage ?? ''}
                onChange={(e) => patchRecord({ yardage: e.target.value ? Number(e.target.value) : undefined })}
              />
            </Field>
          </div>
          <Field label="Walkability">
            <select
              className="input"
              value={record.walkability || ''}
              onChange={(e) => patchRecord({ walkability: (e.target.value || undefined) as CourseRecord['walkability'] })}
            >
              <option value="">—</option>
              {WALKABILITY.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Editorial (detail page)">
            <textarea
              className="input"
              rows={5}
              value={record.editorial_note || ''}
              onChange={(e) => patchRecord({ editorial_note: e.target.value })}
            />
          </Field>
          <Field label="Rate notes">
            <textarea
              className="input"
              rows={3}
              value={record.rate_notes || ''}
              onChange={(e) => patchRecord({ rate_notes: e.target.value })}
            />
          </Field>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 16, background: '#fff' }}>
          {section('Rates (standard card)')}
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
            Leave blank for no row. Seasonal / guest rates: add via SQL for now.
          </p>
          <Field label="Rates verified date">
            <input
              className="input"
              type="date"
              value={record.rates_updated_at?.slice(0, 10) || ''}
              onChange={(e) => patchRecord({ rates_updated_at: e.target.value || undefined })}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {rateFields.map(([label, key]) => (
              <Field key={key} label={label}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="$"
                  value={rates[key]}
                  onChange={(e) =>
                    setRates((prev) => ({
                      ...prev,
                      [key]: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                />
              </Field>
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 16, background: '#fff' }}>
          {section('Policy')}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}>
            <input type="checkbox" checked={prepaid} onChange={(e) => setPrepaid(e.target.checked)} />
            Prepaid at booking
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={Boolean(record.twilight_discount)}
              onChange={(e) => patchRecord({ twilight_discount: e.target.checked })}
            />
            Twilight discount
          </label>
          <Field label="Booking window (days)">
            <input
              className="input"
              type="number"
              value={record.booking_window_days ?? ''}
              onChange={(e) =>
                patchRecord({ booking_window_days: e.target.value ? Number(e.target.value) : undefined })
              }
            />
          </Field>
          <Field label="Booking opens time">
            <input
              className="input"
              value={record.booking_opens_time || ''}
              onChange={(e) => patchRecord({ booking_opens_time: e.target.value })}
              placeholder="7:00 AM"
            />
          </Field>
          <Field label="Cancellation policy">
            <textarea
              className="input"
              rows={2}
              value={record.cancellation_policy || ''}
              onChange={(e) => patchRecord({ cancellation_policy: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSave()}>
          {busy ? 'Saving…' : 'Save course'}
        </button>
        <Link className="btn" to="/admin/courses">
          Cancel
        </Link>
      </div>
    </div>
  );
}
