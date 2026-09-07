import { useEffect, useState } from 'react';

/** Reactive `matchMedia`, so layout decisions can live in one place. */
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
