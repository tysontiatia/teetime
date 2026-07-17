import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

type AuthApi = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

function redirectOrigin(): string {
  return window.location.origin;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) {
        setSession(data.session ?? null);
        setLoading(false);
      }
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Avoid churning session identity (and every downstream consumer) when a
      // background refresh yields the same user + token, e.g. on tab refocus.
      setSession((prev) => {
        if (prev?.access_token === next?.access_token && prev?.user?.id === next?.user?.id) {
          return prev;
        }
        return next;
      });
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signInWithGoogle: async () => {
        const origin = redirectOrigin();
        const redirectTo = `${origin}/auth/callback.html`;
        try {
          sessionStorage.setItem('tt_auth_return_to', `${origin}/app/`);
        } catch {
          // ignore if storage is unavailable
        }
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo },
        });
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    }),
    [session, loading]
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
