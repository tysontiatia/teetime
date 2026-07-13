/**
 * Soft per-IP rate limits via Cache API (best-effort across Worker isolates).
 * Tuned so normal search (many /v1/availability calls) stays fine; scrapers hit 429.
 */

function clientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

/**
 * @param {Request} request
 * @param {{ bucket: string, limit: number, windowSec: number }} opts
 * @returns {Promise<{ limited: boolean, remaining: number, resetSec: number }>}
 */
export async function checkIpRateLimit(request, { bucket, limit, windowSec }) {
  const ip = clientIp(request);
  const windowMs = Math.max(1, windowSec) * 1000;
  const windowId = Math.floor(Date.now() / windowMs);
  const keyUrl = `https://tee-time-rate-limit.internal/${bucket}/${encodeURIComponent(ip)}/${windowId}`;
  const cache = caches.default;

  let count = 0;
  try {
    const hit = await cache.match(keyUrl);
    if (hit) {
      count = Number(await hit.text()) || 0;
    }
  } catch {
    // Cache miss / unavailable — allow the request.
    return { limited: false, remaining: limit, resetSec: windowSec };
  }

  count += 1;
  const limited = count > limit;
  try {
    await cache.put(
      keyUrl,
      new Response(String(count), {
        headers: {
          'Cache-Control': `max-age=${windowSec}`,
          'Content-Type': 'text/plain',
        },
      }),
    );
  } catch {
    // ignore put failures
  }

  return {
    limited,
    remaining: Math.max(0, limit - count),
    resetSec: windowSec,
  };
}

export function rateLimitResponse(corsHeaders, { resetSec }) {
  return new Response(JSON.stringify({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' }), {
    status: 429,
    headers: {
      ...corsHeaders,
      'Retry-After': String(Math.max(1, resetSec || 60)),
      'Content-Type': 'application/json',
    },
  });
}

/** Generous enough for statewide finder refreshes (~67 courses). */
export const RATE_LIMITS = {
  availability: { bucket: 'availability', limit: 240, windowSec: 60 },
  feed: { bucket: 'feed', limit: 60, windowSec: 60 },
  vendorLive: { bucket: 'vendor-live', limit: 90, windowSec: 60 },
  places: { bucket: 'places', limit: 120, windowSec: 60 },
};
