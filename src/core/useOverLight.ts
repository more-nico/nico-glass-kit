import { useContext, useEffect, useState } from 'react';
import { GlassConfigContext } from './GlassProvider';

export type OverLight = boolean | 'auto';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/**
 * Resolves `overLight` (`boolean | 'auto'`) to a concrete boolean.
 * `'auto'` follows `prefers-color-scheme`. SSR-safe: renders `false`
 * (dark assumption) on the server and on first client render, then
 * synchronises inside an effect to avoid hydration mismatch.
 */
export function useOverLight(overLight?: OverLight): boolean {
  const ctx = useContext(GlassConfigContext);
  const resolved: OverLight = overLight ?? ctx.overLight ?? 'auto';

  const [autoLight, setAutoLight] = useState(false);

  useEffect(() => {
    if (resolved !== 'auto') return;
    const mql = window.matchMedia(LIGHT_QUERY);
    const update = () => setAutoLight(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [resolved]);

  return resolved === 'auto' ? autoLight : resolved;
}
