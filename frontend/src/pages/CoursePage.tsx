import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SortBy, TeeTime, TimeOfDayPreset } from '../types';
import { formatDateShort, formatTime12h, matchesPreset, toYmd } from '../lib/time';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { fetchTeeTimesForCourse } from '../lib/workerTimes';
import { capabilityHint, getPlatformCapability, platformDisplayName, workerSupportedPlatform } from '../lib/platformRegistry';
import { WeatherStrip } from '../components/WeatherStrip';
import { NotificationModal } from '../components/NotificationModal';
import { googleMapsPlaceUrl } from '../lib/mapsLinks';
import { useAuth } from '../state/AuthContext';
import { publishRoundFromPlan, planFromCourseVisibleTimes } from '../lib/roundsApi';
import { copyTextToClipboard } from '../lib/clipboard';
import { absoluteRoundUrl } from '../lib/shareUrl';

function clampPlayers(n: number): 1 | 2 | 3 | 4 {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  return 4;
}

function clampHoles(n: number): 9 | 18 {
  return n === 9 ? 9 : 18;
}

export function CoursePage() {
  const nav = useNavigate();
  const { courseId } = useParams();
  const [sp] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { courses, recordsBySlug, loading: catalogLoading } = useCourseCatalog();
  const coursesById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const date = sp.get('date') || toYmd(new Date());
  const players = clampPlayers(Number(sp.get('players') || 2));
  const holes = clampHoles(Number(sp.get('holes') || 18));
  const tod = ((sp.get('tod') as TimeOfDayPreset) || 'any') satisfies TimeOfDayPreset;
  const sort = ((sp.get('sort') as SortBy) || 'soonest') satisfies SortBy;

  const course = useMemo(() => courses.find((c) => c.id === courseId) ?? null, [courses, courseId]);
  const record = courseId ? recordsBySlug.get(courseId) : undefined;

  const [notifOpen, setNotifOpen] = useState(false);
  const [rawTimes, setRawTimes] = useState<TeeTime[]>([]);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareErr, setShareErr] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || !record || !workerSupportedPlatform(record.platform)) {
      setRawTimes([]);
      return;
    }
    let cancelled = false;
    setLoadingTimes(true);
    void (async () => {
      try {
        const list = await fetchTeeTimesForCourse(record, courseId, date, holes, players);
        if (!cancelled) setRawTimes(list);
      } catch {
        if (!cancelled) setRawTimes([]);
      } finally {
        if (!cancelled) setLoadingTimes(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, record, date, holes, players]);

  const times = useMemo(() => {
    const list = rawTimes
      .filter((t) => matchesPreset(t.startsAt, tod))
      .filter((t) => t.spots == null || t.spots >= players)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    if (sort === 'price') {
      list.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    }
    return list;
  }, [rawTimes, tod, players, sort]);

  if (catalogLoading && !course) {
    return (
      <div className="container">
        <div style={{ padding: 18, color: 'var(--muted)' }}>Loading course…</div>
      </div>
    );
  }

  if (!course || !courseId) {
    return (
      <div className="container">
        <div style={{ padding: 18, background: 'rgba(255,255,255,0.8)', border: '1px solid var(--border)', borderRadius: 16 }}>
          <div style={{ fontWeight: 900 }}>Course not found</div>
          <Link className="btn" to="/" style={{ marginTop: 10 }}>
            Back to finder
          </Link>
        </div>
      </div>
    );
  }

  const cap = record ? getPlatformCapability(record.platform) : 'booking_link_only';
  const unsupported = !record || cap !== 'live_inventory';

  const onShareTimes = async () => {
    if (unsupported || times.length === 0) return;
    const uid = user?.id;
    if (!uid) {
      setShareErr('Sign in with Google in the header to create a share link.');
      return;
    }
    setShareBusy(true);
    setShareErr(null);
    const planPayload = planFromCourseVisibleTimes(course, date, times, players);
    const host =
      (user?.user_metadata?.full_name as string | undefined) ||
      (user?.user_metadata?.name as string | undefined) ||
      user?.email?.split('@')[0] ||
      null;
    const res = await publishRoundFromPlan({
      plan: planPayload,
      coursesById,
      organizerId: uid,
      hostPublicName: host,
    });
    setShareBusy(false);
    if ('error' in res) {
      setShareErr(res.error);
      return;
    }
    const url = absoluteRoundUrl(res.slug);
    const copied = await copyTextToClipboard(url);
    if (!copied) {
      setShareErr('Vote page created, but the link could not be copied automatically — copy it from the address bar.');
    }
    nav(`/round/${res.slug}`);
  };

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <Link to="/" className="pill">
            ← Back to results
          </Link>
          <h2 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 34, letterSpacing: '-0.03em' }}>
            {course.name} <span style={{ color: 'var(--muted)', fontWeight: 700 }}>({course.city})</span>
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {typeof course.rating === 'number' && (
              <span className="pill">
                ★ {course.rating.toFixed(1)}
                {typeof course.reviewCount === 'number' ? ` · ${course.reviewCount.toLocaleString()} reviews` : ''}
              </span>
            )}
            {typeof course.distanceMi === 'number' && <span className="pill">{course.distanceMi.toFixed(1)} mi</span>}
            <span className="pill">{formatDateShort(date)}</span>
            <span className="pill">
              {players} player{players === 1 ? '' : 's'} · {holes} holes
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {!unsupported && times.length > 0 ? (
            <button
              className="btn btn-primary"
              type="button"
              disabled={shareBusy || authLoading || !user}
              onClick={() => void onShareTimes()}
              title={
                authLoading
                  ? 'Checking account…'
                  : !user
                    ? 'Sign in with Google in the header to create a share link'
                    : `Creates a vote page with all ${times.length} times below (after filters) and copies the link`
              }
            >
              {shareBusy ? 'Creating…' : `Share times (${times.length})`}
            </button>
          ) : null}
          <button className="btn" type="button" onClick={() => setNotifOpen(true)} title="Notifications">
            🔔 Alerts
          </button>
          {course.bookingUrl && (
            <a className="btn btn-ghost" href={course.bookingUrl} target="_blank" rel="noreferrer">
              Open booking site →
            </a>
          )}
        </div>
      </div>

      {shareErr ? (
        <p style={{ marginTop: 10, color: '#9a3412', fontSize: 14 }}>
          {shareErr}
        </p>
      ) : null}

      <div className="split-two" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
        <div style={{ border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden', background: 'rgba(255,255,255,0.85)' }}>
          {course.photoUrl ? (
            <img src={course.photoUrl} alt="" style={{ width: '100%', height: 240, objectFit: 'cover', display: 'block' }} />
          ) : null}
          <div style={{ padding: 14 }}>
            <div
              style={{
                marginBottom: 14,
                padding: 12,
                borderRadius: 14,
                border: '1px solid var(--border)',
                background: 'rgba(248,250,248,0.95)',
              }}
            >
              <div style={{ fontWeight: 900, letterSpacing: '-0.02em', marginBottom: 6 }}>Google reviews</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
                Star ratings and review counts in the catalog come from Google Places. Full review text stays on Google — we open Maps so we do not need your Maps API key in the browser.
              </p>
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {typeof course.rating === 'number' ? (
                  <span className="pill" style={{ fontWeight: 800 }}>
                    ★ {course.rating.toFixed(1)}
                    {typeof course.reviewCount === 'number' ? ` · ${course.reviewCount.toLocaleString()} reviews` : ''}
                  </span>
                ) : typeof course.reviewCount === 'number' ? (
                  <span className="pill" style={{ fontWeight: 800 }}>
                    {course.reviewCount.toLocaleString()} reviews
                  </span>
                ) : (
                  <span className="pill" style={{ fontWeight: 700, color: 'var(--muted)' }}>
                    No rating in catalog
                  </span>
                )}
                <a
                  className="btn btn-primary"
                  href={googleMapsPlaceUrl(course)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ padding: '8px 14px', fontSize: 13 }}
                >
                  Read reviews on Google Maps →
                </a>
              </div>
              {record?.address ? <div style={{ marginTop: 10, fontSize: 13, color: 'var(--muted)' }}>{record.address}</div> : null}
            </div>

            <WeatherStrip lat={course.lat} lng={course.lng} dateYmd={date} />

            <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>Tee times</div>
            <div style={{ color: 'var(--muted)', marginTop: 4 }}>
              {user ? (
                <>
                  <strong style={{ color: 'var(--ink)' }}>Share times</strong> uses every slot below that matches your filters. The link is copied for you — paste it in your group chat.
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--ink)' }}>Share times</strong> (after you sign in) uses every slot below that matches your filters. The link is copied for you — paste it in your group chat.
                </>
              )}
            </div>

            {unsupported ? (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid var(--border)', color: 'var(--muted)' }}>
                <strong style={{ color: 'var(--ink)' }}>{platformDisplayName(record?.platform)}</strong>
                {' — '}
                {capabilityHint(cap)}.{' '}
                {course.bookingUrl ? (
                  <a href={course.bookingUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--green-2)', fontWeight: 700 }}>
                    Open booking site →
                  </a>
                ) : null}
              </div>
            ) : loadingTimes ? (
              <div style={{ marginTop: 12, color: 'var(--muted)' }}>Loading tee times…</div>
            ) : (
              <div className="times-grid" style={{ marginTop: 12 }}>
                {times.slice(0, 18).map((t) => (
                  <div
                    key={t.id}
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      background: '#fff',
                      border: '1px solid rgba(45,122,58,0.22)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <div style={{ fontWeight: 950, color: 'var(--green-2)' }}>{formatTime12h(t.startsAt)}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{typeof t.price === 'number' ? `$${t.price}` : '—'}</div>
                    {typeof t.spots === 'number' && (
                      <div style={{ fontSize: 11, color: '#b45309', fontWeight: 900 }}>
                        {t.spots} spot{t.spots === 1 ? '' : 's'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!unsupported && !loadingTimes && times.length === 0 && (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: '1px solid var(--border)', color: 'var(--muted)' }}>
                No matching times for this filter set (or the course has not released times yet).
              </div>
            )}
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 18, background: 'rgba(255,255,255,0.75)', padding: 14 }}>
          <div style={{ fontWeight: 900, letterSpacing: '-0.02em' }}>Shared rounds</div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--muted)', lineHeight: 1.6 }}>
            <li>
              <strong>Share times</strong> — {user ? 'one click' : 'sign in, then one click'}; every filtered tee time goes into the vote link.
            </li>
            <li>Check the weather strip above for conditions that day.</li>
            <li>Everyone opens the same link to vote; you book when the group agrees.</li>
          </ul>
        </div>
      </div>

      <NotificationModal open={notifOpen} onClose={() => setNotifOpen(false)} course={course} defaultDate={date} />
    </div>
  );
}
