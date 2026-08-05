/** Whether a tee time can host this party size. */
export function teeTimeFitsPlayers(
  t: { spots?: number | null },
  players: number,
): boolean {
  if (typeof t.spots === 'number') return t.spots >= players;
  // Unknown capacity (e.g. chronogolf_slc): only allow solo searches.
  return players <= 1;
}
