import { createLensFilter, lensPassScaleRatios, lensRegionPercent, type LensFilterPass } from './lensFilter';
import type { GlassFilterSpec } from './SvgFilterRegistry';

export interface FilterEntry {
  id: string;
  mapUrl: string;
  width: number;
  height: number;
  passes: LensFilterPass[];
  ratios: number[];
  region: { x: string; y: string; width: string; height: string };
}

/**
 * O(1) reference counting outside React state. Only structural changes publish
 * a snapshot, once per effect burst. Counts never change a rendered graph.
 * Sequential ids avoid 32-bit key-hash collisions in complex/long-lived pages.
 */
export function createFilterStore(namespace: string) {
  const entries = new Map<string, { entry: FilterEntry; count: number }>();
  const keys = new Map<string, string>();
  const listeners = new Set<() => void>();
  let snapshot: readonly FilterEntry[] = [];
  let pending = false;
  let nextId = 0;
  const publish = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      snapshot = [...entries.values()].map(value => value.entry);
      for (const listener of listeners) listener();
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    acquire(spec: GlassFilterSpec): string {
      const existing = entries.get(spec.key);
      if (existing) { existing.count++; return existing.entry.id; }
      const id = `ngs${namespace}-${nextId++}`;
      const descriptor = createLensFilter(spec);
      const entry: FilterEntry = {
        id, mapUrl: spec.mapUrl, width: spec.width, height: spec.height,
        passes: descriptor.passes,
        ratios: lensPassScaleRatios(descriptor.passes, spec.scale),
        region: lensRegionPercent(spec.width, spec.height, descriptor.regionPaddingPx),
      };
      entries.set(spec.key, { entry, count: 1 }); keys.set(id, spec.key); publish();
      return id;
    },
    /** True only when the graph's final owner has released it. */
    release(id: string): boolean {
      const key = keys.get(id);
      if (key === undefined) return false;
      const existing = entries.get(key)!;
      if (--existing.count > 0) return false;
      entries.delete(key); keys.delete(id); publish(); return true;
    },
  };
}
