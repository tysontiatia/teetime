/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_WORKER_URL: string;
  readonly VITE_LAUNCHDARKLY_CLIENT_SIDE_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
