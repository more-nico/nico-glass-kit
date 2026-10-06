import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let query: MediaQueryList | null = null;
const read = () => typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
const refresh = () => {
  query?.removeEventListener('change', refresh);
  // Moving between monitors can change DPR without resizing the CSS box.
  query = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  query.addEventListener('change', refresh);
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (listeners.size === 1) { refresh(); window.addEventListener('resize', refresh); }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('resize', refresh);
      query?.removeEventListener('change', refresh); query = null;
    }
  };
};
/** Shared DPR subscription with the original 2x quality cap and SSR value. */
export function useGlassDpr(): number { return useSyncExternalStore(subscribe, read, () => 1); }
