import { describe, expect, it } from 'vitest';
import { batchBounds, boxesOverlap, packRenderBatches } from './renderBatch';

describe('spatial glass batches', () => {
  it('packs dense peers without mutating their paint order or inputs', () => {
    const a = { x: 0, y: 0, width: 100, height: 40 };
    const b = { x: 110, y: 0, width: 100, height: 40 };
    const input = [b, a];
    expect(packRenderBatches(input)).toEqual([[a, b]]);
    expect(input).toEqual([b, a]);
    expect(batchBounds([a, b])).toEqual({ x: 0, y: 0, width: 210, height: 40 });
  });

  it('keeps sparse panes, overlaps and oversized regions separate', () => {
    const a = { x: 0, y: 0, width: 100, height: 40 };
    const sparse = { ...a, x: 800 };
    const overlap = { ...a, x: 50 };
    expect(packRenderBatches([a, sparse])).toHaveLength(2);
    expect(packRenderBatches([a, overlap])).toHaveLength(2);
    expect(packRenderBatches([a, { ...a, y: 500 }])).toHaveLength(2);
    expect(boxesOverlap(a, { ...a, x: 100 })).toBe(false);
  });

  it('encloses fractional geometry without cutting off an edge', () => {
    expect(batchBounds([{ x: 0.5, y: 2.25, width: 100, height: 40 }])).toEqual({ x: 0, y: 2, width: 101, height: 41 });
  });
});
