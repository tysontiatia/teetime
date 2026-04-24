const STORAGE_KEY = 'teetime.voter_key';

/** Stable anonymous id for round votes (per browser). */
export function getOrCreateVoterKey(): string {
  try {
    let k = localStorage.getItem(STORAGE_KEY);
    if (!k || k.length < 8) {
      k = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEY, k);
    }
    return k;
  } catch {
    return crypto.randomUUID();
  }
}
