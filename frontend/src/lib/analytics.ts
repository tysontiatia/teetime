import posthog from 'posthog-js';
import { getPosthogKey } from './env';

const OPT_OUT_KEY = 'tt_analytics_opt_out';

let started = false;

export function isAnalyticsOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function persistOptOut(optOut: boolean): void {
  try {
    if (optOut) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // ignore
  }
}

export function isAnalyticsNonProdHost(hostname = window.location.hostname): boolean {
  if (import.meta.env.DEV) return true;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.pages.dev');
}

/** `?tt_notrack=1` opts this browser out; `=0` turns capture back on. */
export function consumeAnalyticsQueryFlag(): void {
  const raw = new URLSearchParams(window.location.search).get('tt_notrack');
  if (raw === '1') persistOptOut(true);
  if (raw === '0') persistOptOut(false);
}

/** Same public project as the marketing homepage. Skips local, preview, and opted-out browsers. */
export function initAnalytics(): boolean {
  if (started) return !posthog.has_opted_out_capturing();
  if (isAnalyticsNonProdHost() || isAnalyticsOptedOut()) return false;
  const key = getPosthogKey();
  if (!key) return false;
  posthog.init(key, {
    api_host: 'https://us.i.posthog.com',
    // Route changes are captured in PostHogTracker. Pageleave stays on for web analytics.
    capture_pageview: false,
    capture_pageleave: true,
    persistence: 'localStorage+cookie',
    // People exist only after identify(), so anonymous search stays cheap.
    person_profiles: 'identified_only',
    session_recording: { maskAllInputs: true },
    capture_exceptions: true,
  });
  started = true;
  return true;
}

export function optOutAnalytics(): void {
  persistOptOut(true);
  if (!started) return;
  posthog.opt_out_capturing();
  posthog.reset();
}

export function analyticsReady(): boolean {
  return started && !posthog.has_opted_out_capturing();
}

function canCapture(): boolean {
  return started && !posthog.has_opted_out_capturing() && !isAnalyticsOptedOut();
}

export function captureAppPageview(path: string): void {
  if (!canCapture()) return;
  if (path.startsWith('/admin')) return;
  posthog.capture('$pageview', {
    $current_url: window.location.href,
    path,
  });
}

export function identifyAnalyticsUser(
  id: string,
  props?: { email?: string | null; name?: string | null; isAdmin?: boolean },
): void {
  if (!canCapture()) return;
  const set: Record<string, string | boolean> = {
    signed_in: true,
    is_admin: Boolean(props?.isAdmin),
  };
  if (props?.email) set.email = props.email;
  if (props?.name) set.name = props.name;
  posthog.identify(id, set, { first_signed_in_at: new Date().toISOString() });
}

export function resetAnalytics(): void {
  if (!started) return;
  posthog.reset();
}

export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export function captureEvent(event: string, props?: AnalyticsProps): void {
  if (!canCapture()) return;
  posthog.capture(event, props);
}
