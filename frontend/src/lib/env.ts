/** Public anon key (RLS); same project as landing `public/index.html`. */
const DEFAULT_SUPABASE_URL = 'https://nmwlebcvezybfwertlzs.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5td2xlYmN2ZXp5YmZ3ZXJ0bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTUzMjcsImV4cCI6MjA5MTkzMTMyN30.N8Q8T6Mf9_AdzysqgD46tOYMnmB8xTNerU9q7GM7Rlg';

const DEFAULT_WORKER_URL = 'https://api.tee-time.io';

// LaunchDarkly client-side ID for the `test` environment in your LaunchDarkly project.
// This is not a secret; it determines which LD environment to evaluate against.
const DEFAULT_LAUNCHDARKLY_CLIENT_SIDE_ID_TEST = '6a4e663319d3db0a5e25b9d1';

export function getSupabaseUrl(): string {
  return import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
}

export function getWorkerBaseUrl(): string {
  return (import.meta.env.VITE_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, '');
}

export function getLaunchDarklyClientSideId(): string {
  return import.meta.env.VITE_LAUNCHDARKLY_CLIENT_SIDE_ID || DEFAULT_LAUNCHDARKLY_CLIENT_SIDE_ID_TEST;
}

/** VAPID public key (safe to expose). Falls back to production key when unset. */
const DEFAULT_VAPID_PUBLIC_KEY =
  'BGsDeJ3VYSXLYIKmQZZeahgY4K72RJ2L8jObIlnnn6rhJSyyDjR8UIVe561Iuf9JynQmPgEEioa-_etmEdiWjRY';

export function getVapidPublicKey(): string {
  return (import.meta.env.VITE_VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY).trim();
}

/** Same project key as `public/index.html` — public, not a secret. */
const DEFAULT_POSTHOG_KEY = 'phc_RCaOhjbjWX2KDt0rzHvFuYRFlfM5D6vQfcdiOA7TnfF';

export function getPosthogKey(): string {
  return (import.meta.env.VITE_POSTHOG_KEY || DEFAULT_POSTHOG_KEY).trim();
}
