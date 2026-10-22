import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  importAdminCourses,
  inspectDiscoveredCourses,
  prepareCourseDiscovery,
  type CourseImportApiRow,
  type DiscoveredCourse,
  type DiscoveryPrepareResult,
} from '../../lib/courseAdminApi';
import { US_STATES } from '../../lib/serviceArea';

async function inspectBatch(
  batch: Parameters<typeof inspectDiscoveredCourses>[0],
  onRetry: (attempt: number) => void,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await inspectDiscoveredCourses(batch);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : '';
      if (attempt === 3 || !/failed to fetch|network|load failed/i.test(message)) throw err;
      onRetry(attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}

function siteLabel(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path && path !== '/' ? path : ''}`;
  } catch {
    return url;
  }
}

function factsLine(row: DiscoveredCourse): string {
  const parts: string[] = [];
  if (row.holes === 9 || row.holes === 18) parts.push(`${row.holes} holes`);
  if (typeof row.par === 'number') parts.push(`par ${row.par}`);
  if (typeof row.yardage === 'number') parts.push(`${row.yardage.toLocaleString()} yards`);
  return parts.join(' · ');
}

export function AdminCoursesDiscoverPage() {
  const [stateCode, setStateCode] = useState('UT');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<DiscoveryPrepareResult | null>(null);
  const [rows, setRows] = useState<DiscoveredCourse[]>([]);
  const [showKnown, setShowKnown] = useState(false);

  const added = useMemo(() => rows.filter((row) => row.validity?.added), [rows]);
  const skipped = useMemo(
    () => rows.filter((row) => row.validity?.action === 'skip' && row.support !== 'catalog_match'),
    [rows],
  );
  const importable = useMemo(
    () => rows.filter((row) => row.import_row && !row.validity?.added && row.validity?.action !== 'skip'),
    [rows],
  );
  const recognized = useMemo(
    () => rows.filter((row) => row.support === 'catalog_match' && row.catalog_match),
    [rows],
  );
  const blocked = useMemo(
    () =>
      rows.filter(
        (row) => !row.import_row && row.support !== 'catalog_match' && row.validity?.action !== 'skip' && !row.validity?.added,
      ),
    [rows],
  );
  const matchedCount = useMemo(() => {
    if (!prepared) return 0;
    const names = new Set(prepared.known.map((course) => course.catalog_match));
    for (const row of recognized) {
      if (row.catalog_match) names.add(row.catalog_match);
    }
    return names.size;
  }, [prepared, recognized]);
  const stillMissing = useMemo(() => {
    if (!prepared) return [];
    const names = new Set(recognized.map((row) => row.catalog_match));
    return prepared.missing.filter((name) => !names.has(name));
  }, [prepared, recognized]);
  async function onFind() {
    const state = stateCode.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      setError('Enter a two-letter state code.');
      return;
    }
    setBusy(true);
    setError(null);
    setPrepared(null);
    setRows([]);
    try {
      const stateName = US_STATES.find((item) => item.code === state)?.name || state;
      setProgress(`Searching the map for golf courses in ${stateName}. This can take a minute.`);
      const result = await prepareCourseDiscovery(state);
      setPrepared(result);
      const next: DiscoveredCourse[] = [];
      for (let i = 0; i < result.pending.length; i += 3) {
        const batch = result.pending.slice(i, i + 3);
        setProgress(
          `Checking websites and confirming courses ${Math.min(i + batch.length, result.pending.length)} of ${result.pending.length}…`,
        );
        const inspected = await inspectBatch(batch, (attempt) => {
          setProgress(
            `Connection dropped. Retrying courses ${Math.min(i + batch.length, result.pending.length)} of ${result.pending.length} (${attempt} of 3)…`,
          );
        });
        for (const course of inspected.courses) next.push(course);
        setRows([...next]);
      }
      setProgress('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discovery failed';
      setError(
        /failed to fetch|network|load failed/i.test(message)
          ? 'The search lost its connection. Courses already checked are saved. Click Find courses to continue.'
          : message,
      );
      setProgress('');
    } finally {
      setBusy(false);
    }
  }

  function markAdded(names: Set<string>, note?: string) {
    setRows((current) =>
      current.map((row) =>
        names.has(row.name)
          ? { ...row, validity: { action: 'import', note: note || row.validity?.note || 'Added.', added: true } }
          : row,
      ),
    );
  }

  function rowForQa(row: DiscoveredCourse): CourseImportApiRow | null {
    if (!row.import_row) return null;
    const note = row.import_row.record.booking_status_note || row.validity?.note || 'Held for booking QA.';
    return {
      ...row.import_row,
      record: {
        ...row.import_row.record,
        booking_status: 'pending',
        booking_status_note: note,
      },
    };
  }

  async function onSaveForQa(list: DiscoveredCourse[]) {
    const ready = list.map(rowForQa).filter((row): row is CourseImportApiRow => Boolean(row));
    if (!ready.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importAdminCourses(ready);
      const named = (items: { name?: string }[]) =>
        new Set(items.map((row) => row.name).filter((name): name is string => Boolean(name)));
      markAdded(named(result.created), 'Saved for booking QA. Hidden on Find until you finish Start booking QA.');
      markAdded(named(result.skipped), 'Already saved. Finish it in Start booking QA.');
      if (result.counts.errors) setError('Some courses could not be saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the course');
    } finally {
      setBusy(false);
    }
  }

  function onSkip(row: DiscoveredCourse) {
    setRows((current) =>
      current.map((item) =>
        item.name === row.name
          ? { ...item, import_row: null, validity: { action: 'skip', note: 'Skipped.' } }
          : item,
      ),
    );
  }

  return (
    <div className="container" style={{ paddingBottom: 40 }}>
      <div style={{ marginTop: 8 }}>
        <Link to="/admin/courses" className="pill">
          ← Back to courses
        </Link>
        <h1 style={{ margin: '12px 0 4px', fontFamily: 'var(--font-display)', fontSize: 32, letterSpacing: '-0.03em' }}>
          Find courses
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14, maxWidth: 680 }}>
          Choose a state. Courses on a booking platform Tee Time already polls are added with live tee times.
          Other booking links are added too, and courses with no online tee sheet are added as phone booking.
          Anything left over can be saved for booking QA or skipped. Saved courses stay off Find until you finish
          them in Start booking QA. Searching the same state again reuses Google results for 30 days.
        </p>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          className="input"
          value={stateCode}
          onChange={(event) => setStateCode(event.target.value)}
          aria-label="State"
          style={{ width: 220 }}
          disabled={busy}
        >
          {US_STATES.map((state) => (
            <option key={state.code} value={state.code}>
              {state.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary" onClick={() => void onFind()} disabled={busy}>
          {busy ? 'Working…' : 'Find courses'}
        </button>
      </div>
      {progress ? (
        <p role="status" style={{ margin: '12px 0 0', fontSize: 15 }}>
          {progress}
        </p>
      ) : null}
      {error ? <p className="admin-err">{error}</p> : null}

      {prepared ? (
        <div style={{ marginTop: 20, display: 'grid', gap: 16 }}>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
            {prepared.map_count} courses on the map in {prepared.state}. {matchedCount} of {prepared.catalog_in_state}{' '}
            live courses in that state matched. {importable.length} need a decision.
          </p>

          {added.length > 0 ? (
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Added to tee-time.io ({added.length})</h2>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
                {added.map((row) => (
                  <li key={row.validity?.slug || row.name}>
                    {row.name}
                    {row.phone_number ? ` — ${row.phone_number}` : ''}
                    {row.validity?.note ? ` — ${row.validity.note}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {skipped.length > 0 ? (
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Skipped ({skipped.length})</h2>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 14 }}>
                {skipped.map((row) => (
                  <li key={row.name}>
                    {row.name}
                    {row.validity?.note ? ` — ${row.validity.note}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {importable.length > 0 ? (
            <section>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <h2 style={{ fontSize: 16, margin: 0 }}>Needs a decision ({importable.length})</h2>
                <button type="button" className="btn btn-primary" onClick={() => void onSaveForQa(importable)} disabled={busy}>
                  Save all for QA
                </button>
                <Link className="btn" to="/admin/courses/qa">
                  Start booking QA
                </Link>
              </div>
              <CourseTable rows={importable} busy={busy} onSave={(row) => void onSaveForQa([row])} onSkip={onSkip} />
            </section>
          ) : null}

          {blocked.length > 0 ? (
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Could not check ({blocked.length})</h2>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 14 }}>
                {blocked.map((row) => (
                  <li key={row.name}>
                    {row.name}
                    {row.note ? ` — ${row.note}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <button type="button" className="btn" onClick={() => setShowKnown((open) => !open)}>
              {showKnown ? 'Hide' : 'Show'} {prepared.known.length + recognized.length} already on tee-time.io
            </button>
            {showKnown ? (
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--muted)', fontSize: 14 }}>
                {prepared.known.map((course) => (
                  <li key={`${course.name}-${course.catalog_match}`}>
                    {course.name} → {course.catalog_match}
                  </li>
                ))}
                {recognized.map((course) => (
                  <li key={`${course.osm_name}-${course.catalog_match}`}>
                    {course.osm_name || course.name} → {course.catalog_match}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {stillMissing.length > 0 ? (
            <section>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>
                On the site, not matched on the map ({stillMissing.length})
              </h2>
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--muted)', fontSize: 14 }}>
                {stillMissing.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CourseTable({
  rows,
  busy,
  onSave,
  onSkip,
}: {
  rows: DiscoveredCourse[];
  busy: boolean;
  onSave: (row: DiscoveredCourse) => void;
  onSkip: (row: DiscoveredCourse) => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, overflow: 'auto', background: 'var(--card)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
        <thead>
          <tr style={{ textAlign: 'left', background: 'color-mix(in srgb, var(--sand) 70%, var(--card))', color: 'var(--muted)', fontSize: 12 }}>
            <th style={{ padding: '10px 12px' }}>Course</th>
            <th style={{ padding: '10px 12px' }}>On Find</th>
            <th style={{ padding: '10px 12px' }}>Website</th>
            <th style={{ padding: '10px 12px' }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px', fontWeight: 700 }}>
                {row.name}
                {row.phone_number ? (
                  <div style={{ fontWeight: 400, fontSize: 12 }}>{row.phone_number}</div>
                ) : null}
                {factsLine(row) ? (
                  <div style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>{factsLine(row)}</div>
                ) : null}
                {row.validity?.note ? (
                  <div style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>{row.validity.note}</div>
                ) : null}
                {row.note ? <div style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>{row.note}</div> : null}
              </td>
              <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>
                Hidden until QA
                {row.platform ? ` · ${row.platform}` : ''}
              </td>
              <td style={{ padding: '8px 12px' }}>
                {row.website ? (
                  <a href={row.website} target="_blank" rel="noreferrer">
                    {siteLabel(row.website)}
                  </a>
                ) : (
                  '—'
                )}
                {row.booking_url ? (
                  <>
                    {' · '}
                    <a href={row.booking_url} target="_blank" rel="noreferrer">
                      Booking
                    </a>
                  </>
                ) : null}
              </td>
              <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onSave(row)}>
                  Save for QA
                </button>{' '}
                <button type="button" className="btn" disabled={busy} onClick={() => onSkip(row)}>
                  Skip
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
