import { useEffect, useState } from 'react';

/** Subscribe to a CSS media query. Defaults to `false` before mount. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Same breakpoint as the mobile bottom nav / compact shell (≤720px). */
export function useIsCompactShell(): boolean {
  return useMediaQuery('(max-width: 720px)');
}
