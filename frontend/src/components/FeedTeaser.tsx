import { Link } from 'react-router-dom';
import { useCourseCatalog } from '../state/CourseCatalogContext';
import { FeedActivityCard } from './FeedActivityCard';
import { useScopedOpenings } from '../hooks/useScopedOpenings';
import { feedQueryString } from '../lib/finderUrl';
import { feedChipDetectedShort, FINDER_PREVIEW_HOURS } from '../lib/feedDisplay';

const PREVIEW_LIMIT = 6;

type Props = {
  players: number;
  fetchAllUtah?: boolean;
  locationQuery?: string;
};

export function FeedTeaser({ players, fetchAllUtah = false, locationQuery = '' }: Props) {
  const { recordsBySlug } = useCourseCatalog();
  const {
    items,
    openCount,
    hotCount,
    loading,
    isRegional,
    scopeLabel,
    scopeReady,
    catalogLoading,
    statewideHiddenCount,
    allItems,
  } = useScopedOpenings({ fetchAllUtah, locationQuery });

  const windowLabel = `last ${FINDER_PREVIEW_HOURS} hours`;
  const feedHref = `/feed?${feedQueryString({ players, locationQuery, fetchScope: fetchAllUtah ? 'all' : 'nearby' })}`;
  const statewideHref = `/feed?${feedQueryString({ players, locationQuery, fetchScope: 'all' })}`;
  const freshest = items[0] ? feedChipDetectedShort(items[0]) : null;

  if (!scopeReady || catalogLoading || (loading && allItems.length === 0)) {
    return (
      <p className="live-activity-bar live-activity--mobile live-activity-bar--loading" aria-busy="true">
        Checking for fresh openings nearby…
      </p>
    );
  }

  if (allItems.length === 0) return null;

  if (openCount === 0 && isRegional && statewideHiddenCount > 0) {
    return (
      <>
        <p className="live-activity-bar live-activity--mobile live-activity-bar--nudge">
          Nothing fresh {scopeLabel.toLowerCase()} in the {windowLabel}.{' '}
          <Link to={statewideHref} className="live-activity-link">
            {statewideHiddenCount} elsewhere →
          </Link>
        </p>
        <section className="live-activity live-activity--desktop live-activity--nudge" aria-label="Recent openings elsewhere">
          <p className="live-activity-nudge">
            Nothing fresh {scopeLabel.toLowerCase()} in the {windowLabel}.{' '}
            <Link to={statewideHref} className="live-activity-link">
              See {statewideHiddenCount} elsewhere in Utah →
            </Link>
          </p>
        </section>
      </>
    );
  }

  if (openCount === 0) return null;

  const preview = items.slice(0, PREVIEW_LIMIT);

  return (
    <>
      <Link to={feedHref} className="live-activity-bar live-activity--mobile">
        <span className="live-activity-bar-dot" aria-hidden />
        <span className="live-activity-bar-text">
          {hotCount > 0 ? (
            <strong className="live-activity-bar-hot">{hotCount} live · </strong>
          ) : null}
          {openCount} fresh nearby
          {freshest ? ` · ${freshest}` : ''}
        </span>
        <span className="live-activity-bar-arrow" aria-hidden>
          →
        </span>
      </Link>

      <section className="live-activity live-activity--desktop" aria-label="Live tee time activity nearby">
        <div className="live-activity-head">
          <div className="live-activity-head-main">
            <div className="live-activity-pill">Live activity</div>
            <h2 className="live-activity-title">Fresh openings near you</h2>
            <p className="live-activity-sub">
              Detected in the {windowLabel}
              {hotCount > 0 ? (
                <>
                  {' · '}
                  <span className="live-activity-hot">{hotCount} live</span>
                </>
              ) : null}
              {' · '}
              {openCount} {scopeLabel.toLowerCase()} · {players} player{players !== 1 ? 's' : ''}
            </p>
          </div>
          <Link to={feedHref} className="live-activity-link live-activity-link--head">
            Browse all →
          </Link>
        </div>

        <ul className="live-activity-grid">
          {preview.map((item) => (
            <li key={item.id}>
              <FeedActivityCard
                item={item}
                record={recordsBySlug.get(item.course_slug)}
                minPlayers={players}
              />
            </li>
          ))}
        </ul>

        {isRegional && statewideHiddenCount > 0 ? (
          <p className="live-activity-foot">
            <Link to={statewideHref} className="live-activity-link">
              +{statewideHiddenCount} more statewide →
            </Link>
          </p>
        ) : null}
      </section>
    </>
  );
}
