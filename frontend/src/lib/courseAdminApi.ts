import { getWorkerBaseUrl } from './env';
import { supabase } from './supabase';
import type { CourseRecord } from './courseRecord';
import type { AdminCourseDetail, AdminCourseListItem } from './adminCourseTypes';

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in required');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getWorkerBaseUrl();
  const headers = await authHeaders();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export async function fetchIsAdmin(): Promise<boolean> {
  const { data: session } = await supabase.auth.getSession();
  const uid = session.session?.user?.id;
  if (!uid) return false;
  const { data, error } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
  if (error || !data) return false;
  return Boolean(data.is_admin);
}

export async function listAdminCourses(): Promise<AdminCourseListItem[]> {
  const data = await adminFetch<{ courses: AdminCourseListItem[] }>('/admin/courses');
  return data.courses;
}

export async function getAdminCourse(slug: string): Promise<AdminCourseDetail> {
  return adminFetch<AdminCourseDetail>(`/admin/courses/${encodeURIComponent(slug)}`);
}

export type SaveCoursePayload = {
  slug?: string;
  record: CourseRecord;
  prepaid: boolean;
  rates: Record<string, number>;
};

export type SaveCourseResult = {
  ok: boolean;
  slug: string;
  rates_written: number;
  platform_warnings: string[];
};

export async function createAdminCourse(payload: SaveCoursePayload): Promise<SaveCourseResult> {
  return adminFetch<SaveCourseResult>('/admin/courses', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAdminCourse(slug: string, payload: Omit<SaveCoursePayload, 'slug'>): Promise<SaveCourseResult> {
  return adminFetch<SaveCourseResult>(`/admin/courses/${encodeURIComponent(slug)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export type PlacesLookupResult = {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
  rating?: number | null;
  review_count?: number | null;
  website?: string | null;
  phone_number?: string | null;
  photo_reference?: string | null;
};

export async function lookupPlaces(query: string, lat?: number, lng?: number): Promise<PlacesLookupResult> {
  return adminFetch<PlacesLookupResult>('/admin/places/lookup', {
    method: 'POST',
    body: JSON.stringify({ query, lat, lng }),
  });
}

export type ParseBookingUrlResult = {
  booking_url: string;
  platform: string | null;
  hints: Record<string, string>;
  /** Optional course metadata scraped from the vendor page (ForeUp). */
  meta?: {
    name?: string | null;
    address?: string | null;
    lat?: number | null;
    lng?: number | null;
    phone_number?: string | null;
    website?: string | null;
    holes?: number | null;
  } | null;
};

export async function parseBookingUrl(url: string): Promise<ParseBookingUrlResult> {
  return adminFetch<ParseBookingUrlResult>('/admin/parse-booking-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}
