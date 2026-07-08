import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import LDClient from 'launchdarkly-js-client-sdk';
import { getLaunchDarklyClientSideId } from '../lib/env';
import { useAuth } from './AuthContext';

type LDClientInstance = ReturnType<typeof LDClient.initialize>;

type LaunchDarklyUserContext = {
  kind: 'user';
  key: string;
  email?: string;
};

type LaunchDarklyAnonymousContext = {
  kind: 'anonymous';
  key: string;
};

type LaunchDarklyEvaluationContext = LaunchDarklyUserContext | LaunchDarklyAnonymousContext;

type LDContextValue = {
  client: LDClientInstance | null;
  ready: boolean;
};

const LaunchDarklyContext = createContext<LDContextValue | null>(null);

const ANON_KEY_STORAGE = 'tt_ld_anon_key_v1';
function getAnonKey(): string {
  try {
    const existing = localStorage.getItem(ANON_KEY_STORAGE);
    if (existing) return existing;
    const next = `anon_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
    localStorage.setItem(ANON_KEY_STORAGE, next);
    return next;
  } catch {
    // If localStorage is unavailable, fall back to an in-memory key.
    return `anon_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
  }
}

function makeLDContext(user: User | null): LaunchDarklyEvaluationContext {
  if (user) {
    return {
      kind: 'user',
      key: user.id,
      email: user.email,
    };
  }
  return {
    kind: 'anonymous',
    key: getAnonKey(),
  };
}

export function LaunchDarklyProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [ready, setReady] = useState(false);
  const clientRef = useRef<LDClientInstance | null>(null);
  const anonInitRef = useRef(false);

  const [clientState, setClientState] = useState<LDClientInstance | null>(null);

  const ldContext = useMemo(() => makeLDContext(user), [user]);

  useEffect(() => {
    // Initialize once; then identify on auth changes.
    if (anonInitRef.current) return;
    anonInitRef.current = true;

    const clientSideId = getLaunchDarklyClientSideId();
    const context = makeLDContext(user);
    const client = LDClient.initialize(clientSideId, context, {
      // Keep this simple for onboarding: we only need flag evaluation.
      // Events are still sent when the SDK is available, but we avoid extra noise.
      sendEvents: true,
      bootstrap: 'localStorage',
    });

    clientRef.current = client;
    setClientState(client);

    try {
      client.on('ready', () => setReady(true));
      client.on('failed', () => setReady(true)); // Don't block UI on LD connectivity.
    } catch {
      // If the SDK event wiring differs, we still proceed; variation() calls will just use defaults.
      setReady(true);
    }

    return () => {
      try {
        client.close();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;

    try {
      if (typeof client.identify === 'function') {
        client.identify(ldContext);
      } else {
        // Fallback: update isn't supported; no-op.
      }
    } catch {
      // ignore identification errors; evaluation will use current cached context.
    }
  }, [ldContext]);

  const value = useMemo<LDContextValue>(() => ({ client: clientState, ready }), [clientState, ready]);

  return <LaunchDarklyContext.Provider value={value}>{children}</LaunchDarklyContext.Provider>;
}

export function useLaunchDarkly(): LDContextValue {
  const ctx = useContext(LaunchDarklyContext);
  if (!ctx) throw new Error('useLaunchDarkly must be used within LaunchDarklyProvider');
  return ctx;
}

