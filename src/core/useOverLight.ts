import { useContext, useEffect, useState } from 'react';
import { GlassConfigContext } from './GlassProvider';
import { useBackdropLight, type ElementRefLike } from './useBackdropLight';

export type OverLight = boolean | 'auto';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

/** `prefers-color-scheme` fallback (the legacy `'auto'` behaviour). */
function usePrefersLight(): boolean {
  const [light, setLight] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(LIGHT_QUERY);
    const update = () => setLight(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return light;
}

/**
 * Resolves `overLight` (`boolean | 'auto'`) to a concrete boolean.
 * Explicit booleans are hard overrides. `'auto'` samples the luminance of
 * the backdrop actually painted beneath each element (per-element
 * light/dark, see `useBackdropLight`); when sampling cannot resolve (SSR,
 * first render, offscreen, unreadable backdrop) it falls back to
 * `prefers-color-scheme`. Pass the element's `ref` to enable backdrop
 * sampling; without a ref `'auto'` follows the OS scheme.
 * SSR-safe: renders `false` (dark assumption) on the server and on first
 * client render, then synchronises inside an effect to avoid hydration
 * mismatch.
 */
export function useOverLight(overLight?: OverLight, ref?: ElementRefLike | null): boolean {
  const ctx = useContext(GlassConfigContext);
  const resolved: OverLight = overLight ?? ctx.overLight ?? 'auto';
  const prefersLight = usePrefersLight();
  const sampledLight = useBackdropLight(ref ?? null, resolved === 'auto');

  if (resolved !== 'auto') return resolved;
  return sampledLight ?? prefersLight;
}
