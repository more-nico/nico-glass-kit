import { useEffect, useRef, useState } from 'react';
import { decideLight, probeBackdropLight, probeBackdropLightSteps, type BackdropProbe } from './backdropProbe';
import { invalidateProbe, subscribeProbe, type ProbeTarget } from './backdropProbeScheduler';
import { observeResize } from './observeResize';

export interface ElementRefLike {
  current: HTMLElement | null;
}

/**
 * Samples the luminance of the backdrop painted beneath the referenced
 * element and reports whether it should render in Light mode (`true`),
 * Dark mode (`false`), or nothing resolvable yet (`null` — the caller
 * falls back to `prefers-color-scheme`).
 *
 * Triggers (scroll/resize, element resize, DOM mutations, background-image
 * decodes, visibility) are collected by the shared scheduler in
 * `backdropProbeScheduler.ts`: one listener set for every element, probes
 * batched per frame under a time budget, self-inflicted mutations ignored
 * and scrolls that cannot change an element's backdrop skipped. Probing
 * still pauses while the tab is hidden, and the hysteresis in
 * {@link decideLight} keeps the reported mode stable near the threshold.
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

    const applyProbe = (probe: BackdropProbe | null) => {
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
    const target: ProbeTarget = {
      get el() { return ref?.current ?? null; },
      run() {
        const el = ref?.current;
        if (el?.isConnected && !document.hidden) applyProbe(probeBackdropLight(el));
      },
      *createTask() {
        const el = ref?.current;
        if (!el?.isConnected || document.hidden) return;
        const probe = yield* probeBackdropLightSteps(el);
        if (el.isConnected && !document.hidden) applyProbe(probe);
      },
    };

    const unsubscribe = subscribeProbe(target);

    const observed = ref?.current;
    const unobserve = observed ? observeResize(observed, () => invalidateProbe(target)) : undefined;

    return () => {
      unsubscribe();
      unobserve?.();
    };
  }, [enabled, ref]);

  return light;
}
