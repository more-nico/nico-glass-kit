import { useContext, useEffect, useState } from 'react';
import { GlassConfigContext } from './GlassProvider';
import {
  GlassLightGroupLightContext,
  GlassLightGroupRegisterContext,
} from './GlassLightGroup';
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
 * Explicit booleans are hard overrides. `'auto'` normally samples the
 * luminance of the backdrop painted beneath each element (per-element
 * light/dark, see `useBackdropLight`); when the surface is inside a
 * `GlassLightGroup`, the element instead registers with the group and shares
 * its single group-wide decision. When sampling cannot resolve (SSR, first
 * render, offscreen, unreadable backdrop) it falls back to
 * `prefers-color-scheme`. Pass the element's `ref` to enable sampling or
 * group registration; without a ref `'auto'` follows the OS scheme.
 * SSR-safe: renders `false` (dark assumption) on the server and on first
 * client render, then synchronises inside an effect to avoid hydration
 * mismatch.
 */
export function useOverLight(overLight?: OverLight, ref?: ElementRefLike | null): boolean {
  const ctx = useContext(GlassConfigContext);
  const register = useContext(GlassLightGroupRegisterContext);
  const groupLight = useContext(GlassLightGroupLightContext);
  const resolved: OverLight = overLight ?? ctx.overLight ?? 'auto';
  const prefersLight = usePrefersLight();
  const grouped = resolved === 'auto' && register !== null;
  const sampledLight = useBackdropLight(ref ?? null, resolved === 'auto' && !grouped);

  useEffect(() => {
    if (!grouped || !register) return;
    const el = ref?.current;
    if (!el) return;
    return register(el);
  }, [grouped, register, ref]);

  if (resolved !== 'auto') return resolved;
  if (register) return groupLight ?? prefersLight;
  return sampledLight ?? prefersLight;
}
