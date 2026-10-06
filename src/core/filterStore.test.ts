import { describe, expect, it, vi } from 'vitest';
import { createFilterStore } from './filterStore';
import { createLensFilter } from './lensFilter';
import type { GlassFilterSpec } from './SvgFilterRegistry';
const spec: GlassFilterSpec = { key: 'shape', width: 200, height: 120, mapUrl: 'data:image/png;base64,test', scale: 48, blur: 3, saturation: 140, brightness: 1.1, animateBrightness: true, dispersion: 0.1 };

describe('filter ownership and batched publication', () => {
  it('shares a graph until its final owner releases it, without publishing count changes', async () => {
    const store = createFilterStore('a'); const listener = vi.fn(); store.subscribe(listener);
    const id = store.acquire(spec); expect(store.acquire(spec)).toBe(id);
    await Promise.resolve(); expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = store.getSnapshot();
    expect(snapshot[0].passes).toEqual(createLensFilter(spec).passes);
    expect(store.release(id)).toBe(false); await Promise.resolve();
    expect(store.getSnapshot()).toBe(snapshot); expect(listener).toHaveBeenCalledTimes(1);
    expect(store.release(id)).toBe(true); await Promise.resolve();
    expect(store.getSnapshot()).toEqual([]); expect(store.release(id)).toBe(false);
  });
  it('publishes one snapshot for hundreds of acquisitions/releases and keeps old entries stable', async () => {
    const store = createFilterStore('b'), listener = vi.fn(); store.subscribe(listener);
    const ids = Array.from({ length: 500 }, (_, i) => store.acquire({ ...spec, key: String(i) }));
    await Promise.resolve(); expect(listener).toHaveBeenCalledTimes(1);
    const first = store.getSnapshot()[0];
    for (const id of ids.slice(1)) store.release(id);
    await Promise.resolve(); expect(listener).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toEqual([first]);
  });
  it('survives acquire-release-acquire before publication (StrictMode) with no stale ownership', async () => {
    const store = createFilterStore('c'); const old = store.acquire(spec); store.release(old);
    const next = store.acquire(spec); expect(next).not.toBe(old);
    expect(store.release(old)).toBe(false); await Promise.resolve();
    expect(store.getSnapshot().map(e => e.id)).toEqual([next]);
    store.release(next); await Promise.resolve(); expect(store.getSnapshot()).toEqual([]);
  });
  it('does not collide on keys with the same djb2 hash', async () => {
    const store = createFilterStore('d');
    // 33 * 65 + 97 === 33 * 66 + 64.
    expect(store.acquire({ ...spec, key: 'Aa' })).not.toBe(store.acquire({ ...spec, key: 'B@' }));
    await Promise.resolve(); expect(store.getSnapshot()).toHaveLength(2);
  });
});
