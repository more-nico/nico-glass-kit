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
  it('resizes a private graph without replacing its id or animation passes', async () => {
    const store = createFilterStore('resize');
    const id = store.acquire(spec);
    await Promise.resolve();
    const before = store.getSnapshot()[0];
    const resized = { ...spec, key: 'wider', width: 400, mapUrl: 'data:image/png;base64,wider' };
    expect(store.resize(id, resized)).toBe(true);
    await Promise.resolve();
    const after = store.getSnapshot()[0];
    expect(after).toMatchObject({ id, width: 400, height: 120, mapUrl: resized.mapUrl });
    expect(after.passes).toBe(before.passes);
    expect(after.ratios).toBe(before.ratios);
    expect(after.region).not.toEqual(before.region);
    expect(store.acquire(resized)).toBe(id);
    expect(store.release(id)).toBe(false);
    expect(store.release(id)).toBe(true);
    await Promise.resolve();
    expect(store.getSnapshot()).toEqual([]);
  });
  it('never resizes a multiply owned graph or overwrites another geometry', async () => {
    const store = createFilterStore('immutable');
    const id = store.acquire(spec);
    store.acquire(spec);
    expect(store.resize(id, { ...spec, key: 'wider', width: 400 })).toBe(false);
    store.release(id);
    const otherId = store.acquire({ ...spec, key: 'other' });
    expect(store.resize(id, { ...spec, key: 'other', width: 400 })).toBe(false);
    await Promise.resolve();
    expect(store.getSnapshot().map(entry => [entry.id, entry.width])).toEqual([[id, 200], [otherId, 200]]);
    store.release(id);
    expect(store.resize(id, spec)).toBe(false);
  });
  it('retunes private materials in place without reordering unrelated graphs', async () => {
    const store = createFilterStore('retune');
    const id = store.acquire(spec);
    const other = store.acquire({ ...spec, key: 'second' });
    await Promise.resolve();
    const updated = { ...spec, key: 'new-material', brightness: 1.7, dispersion: 0.4, scale: 30 };
    expect(store.update(id, updated)).toBe(true);
    await Promise.resolve();
    expect(store.getSnapshot().map(entry => entry.id)).toEqual([id, other]);
    expect(store.getSnapshot()[0].passes).toEqual(createLensFilter(updated).passes);
    expect(store.acquire(updated)).toBe(id);
    expect(store.update(id, { ...updated, key: 'shared-mutation' })).toBe(false);
    store.release(id); store.release(id); store.release(other);
  });
});
