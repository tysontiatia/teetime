/** Public anon key (RLS); same project as landing `public/index.html`. */
const DEFAULT_SUPABASE_URL = 'https://nmwlebcvezybfwertlzs.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5td2xlYmN2ZXp5YmZ3ZXJ0bHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNTUzMjcsImV4cCI6MjA5MTkzMTMyN30.N8Q8T6Mf9_AdzysqgD46tOYMnmB8xTNerU9q7GM7Rlg';

const DEFAULT_WORKER_URL = 'https://utah-tee-times.tysontiatia.workers.dev';

export function getSupabaseUrl(): string {
  return import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
}

export function getSupabaseAnonKey(): string {
  return import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
}

export function getWorkerBaseUrl(): string {
  return (import.meta.env.VITE_WORKER_URL || DEFAULT_WORKER_URL).replace(/\/$/, '');
}
