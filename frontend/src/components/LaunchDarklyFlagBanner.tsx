import { useEffect, useState } from 'react';
import { useLaunchDarkly } from '../state/LaunchDarklyContext';

const FIRST_FLAG_KEY = 'tt-ld-ui-banner';

export function LaunchDarklyFlagBanner() {
  const { client, ready } = useLaunchDarkly();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!ready || !client) return;

    const evaluate = () => {
      try {
        const v = client.variation(FIRST_FLAG_KEY, false);
        setEnabled(Boolean(v));
      } catch {
        setEnabled(false);
      }
    };

    evaluate();

    try {
      const onChange = (changes: Record<string, unknown> | string[]) => {
        if (!changes) return;
        const hasKey =
          (!Array.isArray(changes) && FIRST_FLAG_KEY in changes) ||
          (Array.isArray(changes) && changes.includes(FIRST_FLAG_KEY));
        if (!hasKey) return;
        evaluate();
      };
      client.on('change', onChange);
      return () => {
        try {
          client.off('change', onChange);
        } catch {
          // ignore
        }
      };
    } catch {
      // If change subscriptions aren't available, the initial evaluation still serves as proof.
      return;
    }
  }, [client, ready]);

  if (!ready || !enabled) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 64,
        left: 12,
        right: 12,
        zIndex: 100,
        background: 'rgba(45,122,58,0.95)',
        color: '#fff',
        borderRadius: 12,
        padding: '10px 12px',
        boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
        border: '1px solid rgba(255,255,255,0.18)',
        fontSize: 13,
        fontWeight: 700,
        textAlign: 'center',
      }}
      role="status"
      aria-live="polite"
    >
      LaunchDarkly is working: UI banner flag is ON.
    </div>
  );
}

