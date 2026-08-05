import { getVapidPublicKey, getWorkerBaseUrl } from './env';
import { supabase } from './supabase';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function fetchVapidPublicKey(): Promise<string | null> {
  const fromEnv = getVapidPublicKey();
  if (fromEnv) return fromEnv;
  try {
    const res = await fetch(`${getWorkerBaseUrl()}/v1/push/vapid-public-key`, {
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { publicKey?: string };
    return data.publicKey?.trim() || null;
  } catch {
    return null;
  }
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePushAlerts(userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!pushSupported()) {
    return { ok: false, message: 'Push isn’t supported in this browser. Try Chrome or Safari on a phone, or install the app.' };
  }
  if (!userId) return { ok: false, message: 'Sign in to enable push alerts.' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, message: 'Notification permission was denied. Enable it in browser settings, then try again.' };
  }

  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    return { ok: false, message: 'Push isn’t configured on the server yet.' };
  }

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Could not subscribe to push.',
      };
    }
  }

  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return { ok: false, message: 'Push subscription was incomplete.' };
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 240) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export async function disablePushAlerts(userId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!userId) return { ok: false, message: 'Sign in required.' };

  try {
    const sub = await getExistingPushSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => undefined);
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', endpoint);
    } else {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not disable push.' };
  }
  return { ok: true };
}

export async function countPushSubscriptions(userId: string): Promise<number> {
  if (!userId) return 0;
  const { count, error } = await supabase
    .from('push_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) return 0;
  return count ?? 0;
}
