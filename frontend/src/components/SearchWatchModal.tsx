import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../state/AuthContext';
import { getWorkerBaseUrl } from '../lib/env';
import { countPushSubscriptions, enablePushAlerts, pushSupported } from '../lib/pushAlerts';
import { isStandaloneDisplay } from '../lib/pwa';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { SignInPromptModal } from './SignInPromptModal';
import { ModalCloseButton } from './ModalCloseButton';
import { captureEvent } from '../lib/analytics';

export type SearchWatchDraft = {
  targetDate: string;
  players: 1 | 2 | 3 | 4;
  holes: 'any' | '9' | '18';
  earliest: string;
  latest: string;
  placeLabel: string;
  anchorLat: number;
  anchorLng: number;
  radiusMi: number | null;
  scope: 'radius' | 'all';
};

export function SearchWatchModal({
  open,
  onClose,
  draft,
  scheduleLine,
  filtersLine,
}: {
  open: boolean;
  onClose: () => void;
  draft: SearchWatchDraft | null;
  scheduleLine: string;
  filtersLine: string;
}) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  useBodyScrollLock(open && Boolean(user));

  useEffect(() => {
    if (!open) {
      setSaving(false);
      setSaved(false);
      setMessage(null);
      setPushMsg(null);
      return;
    }
    setSaved(false);
    setMessage(null);
    setPushMsg(null);
  }, [open, draft?.targetDate, draft?.placeLabel, draft?.players]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !user?.id || !saved) return;
    let cancelled = false;
    void countPushSubscriptions(user.id).then((n) => {
      if (!cancelled) setPushOn(n > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [open, user?.id, saved]);

  if (!open || !draft) return null;

  if (!user) {
    return (
      <SignInPromptModal
        open
        onClose={onClose}
        variant="alert"
        closeOnSignIn={false}
      />
    );
  }

  const askPush = saved && pushSupported() && !pushOn;
  const standalonePush = askPush && isStandaloneDisplay();

  const save = async () => {
    setMessage(null);
    setSaving(true);
    const { data: existing, error: existingErr } = await supabase
      .from('search_watches')
      .select('id')
      .eq('user_id', user.id)
      .eq('active', true)
      .eq('target_date', draft.targetDate)
      .eq('players', draft.players)
      .eq('holes', draft.holes)
      .eq('place_label', draft.placeLabel)
      .eq('scope', draft.scope)
      .limit(1);
    if (existingErr) {
      setSaving(false);
      setMessage(existingErr.message);
      return;
    }
    if ((existing ?? []).length > 0) {
      setSaving(false);
      setMessage('You’re already watching this search. Manage it in Alerts.');
      return;
    }

    const { data: inserted, error } = await supabase
      .from('search_watches')
      .insert({
        user_id: user.id,
        active: true,
        target_date: draft.targetDate,
        players: draft.players,
        holes: draft.holes,
        earliest_time: draft.earliest,
        latest_time: draft.latest,
        place_label: draft.placeLabel,
        anchor_lat: draft.anchorLat,
        anchor_lng: draft.anchorLng,
        radius_mi: draft.radiusMi,
        scope: draft.scope,
      })
      .select('id')
      .single();
    setSaving(false);
    if (error || !inserted) {
      setMessage(error?.message || 'Could not save that search.');
      return;
    }

    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) return;
        await fetch(`${getWorkerBaseUrl()}/v1/alerts/check`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ search_watch_id: inserted.id }),
        });
      } catch {
        // Saved. The poller will match the next opening.
      }
    })();

    captureEvent('search_watch_created', {
      place: draft.placeLabel,
      players: draft.players,
      holes: draft.holes,
      scope: draft.scope,
    });
    setSaved(true);
  };

  const onEnablePush = async () => {
    if (!user.id || pushBusy) return;
    setPushBusy(true);
    setPushMsg(null);
    const res = await enablePushAlerts(user.id);
    setPushBusy(false);
    if (!res.ok) {
      setPushMsg(res.message);
      return;
    }
    setPushOn(true);
    setPushMsg('Notifications are on for this device.');
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-watch-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2 id="search-watch-title" className="modal-header-title">
              {saved ? 'Search watched' : 'Watch this search'}
            </h2>
            <p className="modal-header-sub">{draft.placeLabel}</p>
          </div>
          <ModalCloseButton onClick={onClose} />
        </div>
        {saved ? (
          <>
            <div className="modal-body">
              <p className="alert-confirm-lede">
                {standalonePush
                  ? 'This app can ping you when a course in this search opens a time.'
                  : 'We’ll email you when a course in this search opens a matching time.'}
              </p>
              <div className="alert-summary">
                <div className="alert-summary-kicker">{draft.placeLabel}</div>
                <div className="alert-summary-schedule">{scheduleLine}</div>
                <div className="alert-summary-filters">{filtersLine}</div>
              </div>
              {askPush ? (
                <div className="alert-push-prompt">
                  <div className="alert-push-copy">
                    <div className="alert-push-title">
                      {standalonePush ? 'Turn on notifications' : 'Also notify this device'}
                    </div>
                    <p className="alert-push-hint">
                      {standalonePush
                        ? `Tee times go fast. Email still goes to ${user.email}.`
                        : `Instant banner when a time opens. Email still goes to ${user.email}.`}
                    </p>
                  </div>
                  {standalonePush ? null : (
                    <button
                      type="button"
                      className="btn btn-primary alert-push-btn"
                      disabled={pushBusy}
                      onClick={() => void onEnablePush()}
                    >
                      {pushBusy ? '…' : 'Enable push'}
                    </button>
                  )}
                </div>
              ) : (
                <p className="alert-confirm-email">
                  Email goes to {user.email}
                  {pushOn ? ' · notifications are on for this device' : ''}.
                </p>
              )}
              {pushMsg ? <p className="alert-push-msg">{pushMsg}</p> : null}
            </div>
            <div className="modal-footer">
              <Link to="/account" className="btn" onClick={onClose}>
                Manage Alerts
              </Link>
              {standalonePush ? (
                <button className="btn btn-primary" type="button" disabled={pushBusy} onClick={() => void onEnablePush()}>
                  {pushBusy ? '…' : 'Enable notifications'}
                </button>
              ) : null}
              <button className={standalonePush ? 'btn' : 'btn btn-primary'} type="button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <p className="alert-confirm-lede">
                We’ll watch every live course in this search, not just one.
              </p>
              <div className="alert-summary">
                <div className="alert-summary-kicker">{draft.placeLabel}</div>
                <div className="alert-summary-schedule">{scheduleLine}</div>
                <div className="alert-summary-filters">{filtersLine}</div>
              </div>
              {message ? <div className="modal-msg err">{message}</div> : null}
            </div>
            <div className="modal-footer">
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Watch search'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
