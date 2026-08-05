import { useEffect, useMemo, useState } from 'react';
import type { CourseRecord } from '../lib/courseRecord';
import type { DbRoundOption } from '../lib/roundsApi';
import {
  clampHoles,
  clampPlayers,
  isOptionStillOpen,
  type OptionAvailability,
} from '../lib/roundOptionAvailability';
import { workerSupportedPlatform } from '../lib/platformRegistry';
import { fetchTimesForCourseSlugs } from '../lib/workerTimes';

type FetchKey = string;

function fetchKey(courseId: string, dateYmd: string, holes: 9 | 18, players: 1 | 2 | 3 | 4): FetchKey {
  return `${courseId}|${dateYmd}|${holes}|${players}`;
}

/**
 * Re-checks planned round options against live worker inventory.
 * Keeps all options; marks sold-out / unknown without pruning votes.
 */
export function useRoundOptionsAvailability(
  options: DbRoundOption[],
  playDate: string | null,
  recordsBySlug: Map<string, CourseRecord>,
  catalogLoading: boolean,
) {
  const [byOptionId, setByOptionId] = useState<Map<string, OptionAvailability>>(() => new Map());
  const [loading, setLoading] = useState(false);

  const optionFingerprint = useMemo(
    () =>
      options
        .map((o) => `${o.id}:${o.course_id ?? ''}:${o.date ?? ''}:${o.starts_at ?? ''}:${o.holes}:${o.players}`)
        .join('|'),
    [options],
  );

  useEffect(() => {
    if (catalogLoading) {
      setLoading(true);
      setByOptionId(new Map(options.map((o) => [o.id, 'checking' as const])));
      return;
    }

    if (options.length === 0) {
      setByOptionId(new Map());
      setLoading(false);
      return;
    }

    type Job = {
      key: FetchKey;
      slug: string;
      record: CourseRecord;
      dateYmd: string;
      holes: 9 | 18;
      players: 1 | 2 | 3 | 4;
      optionIds: string[];
    };

    const jobs = new Map<FetchKey, Job>();
    const immediate = new Map<string, OptionAvailability>();

    for (const o of options) {
      const slug = o.course_id?.trim() || '';
      const dateYmd = (o.date || playDate || '').trim();
      const record = slug ? recordsBySlug.get(slug) : undefined;
      const platform = record?.platform;
      if (!slug || !dateYmd || !record || !platform || !workerSupportedPlatform(platform)) {
        immediate.set(o.id, 'unknown');
        continue;
      }
      const holes = clampHoles(o.holes);
      const players = clampPlayers(o.players);
      const key = fetchKey(slug, dateYmd, holes, players);
      const existing = jobs.get(key);
      if (existing) {
        existing.optionIds.push(o.id);
      } else {
        jobs.set(key, {
          key,
          slug,
          record,
          dateYmd,
          holes,
          players,
          optionIds: [o.id],
        });
      }
      immediate.set(o.id, 'checking');
    }

    setByOptionId(new Map(immediate));

    if (jobs.size === 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void (async () => {
      const next = new Map(immediate);
      await Promise.all(
        [...jobs.values()].map(async (job) => {
          const { bySlug, failedSlugs } = await fetchTimesForCourseSlugs(
            [{ slug: job.slug, record: job.record }],
            job.dateYmd,
            job.holes,
            job.players,
            1,
          );
          if (cancelled) return;
          const failed = failedSlugs.includes(job.slug);
          const times = bySlug.get(job.slug) ?? [];
          for (const id of job.optionIds) {
            if (failed) {
              next.set(id, 'unknown');
              continue;
            }
            const opt = options.find((o) => o.id === id);
            if (!opt) {
              next.set(id, 'unknown');
              continue;
            }
            next.set(id, isOptionStillOpen(opt, times) ? 'available' : 'unavailable');
          }
        }),
      );
      if (!cancelled) {
        setByOptionId(new Map(next));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // optionFingerprint encodes options; playDate / catalog / records drive refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint stands in for options
  }, [optionFingerprint, playDate, catalogLoading, recordsBySlug]);

  const stats = useMemo(() => {
    let available = 0;
    let unavailable = 0;
    let unknown = 0;
    let checking = 0;
    for (const o of options) {
      const s = byOptionId.get(o.id) ?? 'checking';
      if (s === 'available') available += 1;
      else if (s === 'unavailable') unavailable += 1;
      else if (s === 'unknown') unknown += 1;
      else checking += 1;
    }
    return { available, unavailable, unknown, checking, total: options.length };
  }, [options, byOptionId]);

  return { availabilityByOptionId: byOptionId, loadingAvailability: loading, stats };
}
