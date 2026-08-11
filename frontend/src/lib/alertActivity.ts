import { supabase } from './supabase';

export type NotificationLogRow = {
  id: string;
  user_id: string;
  course_id: string;
  target_date: string | null;
  channel: 'email' | 'sms' | 'push';
  times_found: number;
  sent_at: string;
  notified_slot_keys?: string[] | null;
  notify_reason?: string | null;
};

/** One user-facing activity row (email+push for the same send are merged). */
export type AlertActivityItem = {
  key: string;
  courseId: string;
  targetDate: string | null;
  timesFound: number;
  channels: Array<'email' | 'sms' | 'push'>;
  sentAt: string;
  unread: boolean;
  /** Parsed from `notified_slot_keys` (`HH:MM:SS|holes`). */
  slotLabels: string[];
  notifyReason: 'event' | 'backstop' | null;
};

const RECENT_LIMIT = 40;

function channelLabel(channel: string): string {
  if (channel === 'push') return 'Push';
  if (channel === 'sms') return 'SMS';
  return 'Email';
}

export function formatAlertChannels(channels: Array<'email' | 'sms' | 'push'>): string {
  return channels.map(channelLabel).join(' · ');
}

export function formatAlertActivityWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatAlertPlayDate(ymd: string | null): string {
  if (!ymd) return 'Open dates';
  const d = new Date(ymd + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** `07:12:00|18` → `7:12 AM` */
export function formatAlertSlotKey(slotKey: string): string | null {
  const m = String(slotKey || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2]!;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${minute} ${period}`;
}

export function formatAlertSlotSummary(labels: string[], max = 3): string {
  if (!labels.length) return '';
  if (labels.length <= max) return labels.join(', ');
  const shown = labels.slice(0, max);
  return `${shown.join(', ')} +${labels.length - max} more`;
}

export function alertActivityHeadline(item: AlertActivityItem): string {
  const n = item.timesFound || item.slotLabels.length;
  const verb = item.notifyReason === 'event' ? 'opened' : 'matched';
  if (n <= 0) return `Alert ${verb}`;
  if (n === 1 && item.slotLabels[0]) return `${item.slotLabels[0]} ${verb}`;
  return `${n} tee time${n === 1 ? '' : 's'} ${verb}`;
}

function mergeSlotLabels(into: string[], keys: string[] | null | undefined) {
  if (!keys?.length) return;
  for (const key of keys) {
    const label = formatAlertSlotKey(key);
    if (label && !into.includes(label)) into.push(label);
  }
}

/** Merge near-simultaneous channel sends for the same course + play date. */
export function groupNotificationLogs(
  rows: NotificationLogRow[],
  seenAt: string | null,
): AlertActivityItem[] {
  const seenMs = seenAt ? new Date(seenAt).getTime() : null;
  const groups = new Map<string, AlertActivityItem>();

  for (const row of rows) {
    const sentMs = new Date(row.sent_at).getTime();
    const bucket = Number.isFinite(sentMs) ? Math.floor(sentMs / 120_000) : 0;
    const key = `${row.course_id}|${row.target_date ?? ''}|${bucket}`;
    const reason =
      row.notify_reason === 'event' || row.notify_reason === 'backstop' ? row.notify_reason : null;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.channels.includes(row.channel)) existing.channels.push(row.channel);
      existing.timesFound = Math.max(existing.timesFound, row.times_found ?? 0);
      if (new Date(row.sent_at) > new Date(existing.sentAt)) existing.sentAt = row.sent_at;
      mergeSlotLabels(existing.slotLabels, row.notified_slot_keys);
      if (!existing.notifyReason && reason) existing.notifyReason = reason;
      continue;
    }
    const slotLabels: string[] = [];
    mergeSlotLabels(slotLabels, row.notified_slot_keys);
    groups.set(key, {
      key,
      courseId: row.course_id,
      targetDate: row.target_date,
      timesFound: row.times_found ?? 0,
      channels: [row.channel],
      sentAt: row.sent_at,
      unread: seenMs == null ? false : sentMs > seenMs,
      slotLabels,
      notifyReason: reason,
    });
  }

  return [...groups.values()].sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
  );
}

export async function fetchNotificationLogs(userId: string): Promise<NotificationLogRow[]> {
  const { data, error } = await supabase
    .from('notification_log')
    .select(
      'id, user_id, course_id, target_date, channel, times_found, sent_at, notified_slot_keys, notify_reason',
    )
    .eq('user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(RECENT_LIMIT);
  if (error || !data) {
    // Older DBs may lack notify_reason — retry without it.
    const fallback = await supabase
      .from('notification_log')
      .select('id, user_id, course_id, target_date, channel, times_found, sent_at, notified_slot_keys')
      .eq('user_id', userId)
      .order('sent_at', { ascending: false })
      .limit(RECENT_LIMIT);
    if (fallback.error || !fallback.data) return [];
    return fallback.data as NotificationLogRow[];
  }
  return data as NotificationLogRow[];
}

export async function fetchAlertsSeenAt(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('alerts_seen_at')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { alerts_seen_at: string | null }).alerts_seen_at ?? null;
}

export async function markAlertsSeen(userId: string, atIso = new Date().toISOString()): Promise<string> {
  const { error } = await supabase.from('profiles').update({ alerts_seen_at: atIso }).eq('id', userId);
  if (error) throw error;
  return atIso;
}

/**
 * First-time seed so existing log history does not flood the badge.
 * Only runs when alerts_seen_at is null.
 */
export async function seedAlertsSeenIfNeeded(
  userId: string,
  currentSeenAt: string | null,
): Promise<string | null> {
  if (currentSeenAt) return currentSeenAt;
  try {
    return await markAlertsSeen(userId);
  } catch {
    return null;
  }
}
