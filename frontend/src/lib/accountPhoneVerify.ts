import { getWorkerBaseUrl } from './env';
import { supabase } from './supabase';

async function authHeaders(): Promise<{ headers: Record<string, string> } | { error: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: 'Sign in required.' };
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function startPhoneVerification(phoneE164: string): Promise<{ error?: string }> {
  const h = await authHeaders();
  if ('error' in h) return { error: h.error };
  const res = await fetch(`${getWorkerBaseUrl()}/account/phone/start`, {
    method: 'POST',
    headers: h.headers,
    body: JSON.stringify({ phone: phoneE164 }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) return { error: j.message || j.error || `Request failed (${res.status})` };
  return {};
}

export async function confirmPhoneVerification(
  phoneE164: string,
  code: string,
): Promise<{ error?: string }> {
  const h = await authHeaders();
  if ('error' in h) return { error: h.error };
  const digits = code.replace(/\D/g, '');
  const res = await fetch(`${getWorkerBaseUrl()}/account/phone/check`, {
    method: 'POST',
    headers: h.headers,
    body: JSON.stringify({ phone: phoneE164, code: digits }),
  });
  const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) return { error: j.message || j.error || `Request failed (${res.status})` };
  return {};
}
