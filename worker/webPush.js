/**
 * Web Push (VAPID) helpers for Cloudflare Workers.
 * Uses @block65/webcrypto-web-push (Web Crypto — no Node crypto).
 */

import { buildPushPayload } from '@block65/webcrypto-web-push';

export function vapidConfigured(env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

export function getVapidPublicKey(env) {
  return env.VAPID_PUBLIC_KEY || '';
}

function vapidKeys(env) {
  return {
    subject: env.VAPID_SUBJECT || 'mailto:alerts@tee-time.io',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
}

/**
 * @returns {{ ok: boolean, status?: number, gone?: boolean }}
 */
export async function sendWebPush(env, subscription, message) {
  if (!vapidConfigured(env)) return { ok: false };
  const sub = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
  try {
    const payload = await buildPushPayload(
      {
        data: typeof message === 'string' ? message : JSON.stringify(message),
        options: {
          ttl: 60 * 60 * 12,
          urgency: 'high',
        },
      },
      sub,
      vapidKeys(env),
    );
    const res = await fetch(subscription.endpoint, payload);
    if (res.status === 404 || res.status === 410) {
      return { ok: false, status: res.status, gone: true };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[web-push] send failed', res.status, body.slice(0, 200));
      return { ok: false, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    console.warn('[web-push] error', err instanceof Error ? err.message : err);
    return { ok: false };
  }
}
