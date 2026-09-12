import { useEffect, useRef, useState } from 'react';
import { decideLight, onImagesSettled, probeBackdropLight } from './backdropProbe';

export interface ElementRefLike {
  current: HTMLElement | null;
}

const RESAMPLE_THROTTLE_MS = 120;

/**
 * Samples the luminance of the backdrop painted beneath the referenced
 * element and reports whether it should render in Light mode (`true`),
 * Dark mode (`false`), or nothing resolvable yet (`null` — the caller
 * falls back to `prefers-color-scheme`).
 *
 * Re-probes throttled (rAF + 120 ms trailing) on scroll/resize, element
 * resize, DOM mutations (theme/background swaps that never scroll), and
 * when probed background images finish decoding. Skipped while the tab is
 * hidden. The hysteresis in {@link decideLight} keeps the reported mode
 * stable near the threshold.
 */
export function useBackdropLight(ref: ElementRefLike | null, enabled: boolean): boolean | null {
  const [light, setLight] = useState<boolean | null>(null);
  const decisionRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!enabled) {
      decisionRef.current = null;
      setLight(null);
      return;
    }

    let disposed = false;
    let raf = 0;
    let trailing = 0;
    let lastRun = 0;

    const run = () => {
      const el = ref?.current;
      if (!el || !el.isConnected || document.hidden) return;
      const probe = probeBackdropLight(el);
      if (!probe) return; // offscreen / not measurable — keep the last decision
      if (probe.averageLuminance === null) {
        // Backdrop unreadable (e.g. a cross-origin iframe): fall back to
        // prefers-color-scheme until a readable backdrop returns.
        if (decisionRef.current !== null) {
          decisionRef.current = null;
          setLight(null);
        }
        return;
      }
      const next = decideLight(probe.averageLuminance, decisionRef.current);
      if (next !== decisionRef.current) {
        decisionRef.current = next;
        setLight(next);
      }
    };

    const schedule = () => {
      if (disposed || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const elapsed = Date.now() - lastRun;
        if (elapsed >= RESAMPLE_THROTTLE_MS) {
          lastRun = Date.now();
          run();
        } else if (!trailing) {
          trailing = window.setTimeout(
            () => {
              trailing = 0;
              lastRun = Date.now();
              run();
            },
            RESAMPLE_THROTTLE_MS - elapsed,
          );
        }
      });
    };

    lastRun = Date.now();
    run();

    const observed = ref?.current;
    const observer =
      typeof ResizeObserver !== 'undefined' && observed ? new ResizeObserver(schedule) : null;
    if (observer && observed) observer.observe(observed);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    const unsubscribeImages = onImagesSettled(schedule);

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (trailing) window.clearTimeout(trailing);
      observer?.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      mutations.disconnect();
      unsubscribeImages();
    };
  }, [enabled, ref]);

  return light;
}
