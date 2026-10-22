import { describe, expect, it } from 'vitest';
import { classifyMutations, decideScrollProbe } from './backdropProbeScheduler';

function element(zone: string | null = null): Element {
  return { closest: () => zone === null ? null : { getAttribute: () => zone } } as unknown as Element;
}
function mutation(target: Element, attributeName?: string): MutationRecord {
  return { target, attributeName, type: attributeName ? 'attributes' : 'childList' } as unknown as MutationRecord;
}

describe('paint invalidation', () => {
  const page = element(), layer = element('style'), registry = element('all');

  it('ignores internal bookkeeping without swallowing real paint changes', () => {
    const internal = [mutation(layer, 'style'), mutation(registry),
      ...['data-ngs-render-batched', 'data-ngs-individual-filter', 'data-ngs-render-batches', 'data-ngs-render-members']
        .map(name => mutation(page, name))];
    expect(classifyMutations(internal)).toEqual({ real: false, lightFlip: false, urgent: false });
    for (const change of [mutation(page), mutation(page, 'class'), mutation(page, 'data-ngs-render-batched-extra')]) {
      expect(classifyMutations([...internal, change])).toEqual({ real: true, lightFlip: false, urgent: true });
    }
  });

  it('defers tint-only transitions but keeps simultaneous page paint urgent', () => {
    const flip = mutation(page, 'data-ngs-light');
    expect(classifyMutations([flip])).toEqual({ real: true, lightFlip: true, urgent: false });
    expect(classifyMutations([flip, mutation(page, 'style')])).toEqual({ real: true, lightFlip: true, urgent: false });
    expect(classifyMutations([flip, mutation(page, 'class')])).toEqual({ real: true, lightFlip: true, urgent: true });
  });
});

describe('scroll invalidation', () => {
  const rect = { top: 100, left: 200, width: 80, height: 40 };
  const doc = {}, inner = {};
  const last = { rect, offsets: new Map([[doc, { top: 0, left: 0 }]]) };

  it.each([
    { name: 'down', top: 60, left: 200, scrollTop: 40, scrollLeft: 0, coMoving: true },
    { name: 'up', top: 140, left: 200, scrollTop: -40, scrollLeft: 0, coMoving: true },
    { name: 'right', top: 100, left: 170, scrollTop: 0, scrollLeft: 30, coMoving: true },
    { name: 'left', top: 100, left: 230, scrollTop: 0, scrollLeft: -30, coMoving: true },
    { name: 'fixed', top: 100, left: 200, scrollTop: 40, scrollLeft: 0, coMoving: false },
    { name: 'sticky', top: 80, left: 200, scrollTop: 40, scrollLeft: 0, coMoving: false },
    { name: 'wrong translation sign', top: 140, left: 200, scrollTop: 40, scrollLeft: 0, coMoving: false },
  ])('$name only skips independently proven co-moving paint', test => {
    const input = { rect: { ...rect, top: test.top, left: test.left }, last,
      offsets: new Map([[doc, { top: test.scrollTop, left: test.scrollLeft }]]), intersects: () => true };
    expect(decideScrollProbe(input)).toBe(true); // A fixed wallpaper remains possible.
    expect(decideScrollProbe({ ...input, paintMovesWithContent: () => true })).toBe(!test.coMoving);
  });

  it('skips unrelated/unchanged scrollers and keeps ambiguous nested movement conservative', () => {
    const input = { rect, last, offsets: new Map([[doc, { top: 0, left: 0 }]]), intersects: () => true };
    expect(decideScrollProbe(input)).toBe(false);
    expect(decideScrollProbe({ ...input, last: null, offsets: new Map([[doc, { top: 30, left: 0 }]]), intersects: () => false })).toBe(false);
    const offsets = new Map([[doc, { top: 40, left: 0 }], [inner, { top: 30, left: 0 }]]);
    const nestedLast = { rect, offsets: new Map([[doc, { top: 0, left: 0 }], [inner, { top: 0, left: 0 }]]) };
    expect(decideScrollProbe({ ...input, rect: { ...rect, top: 30 }, last: nestedLast, offsets,
      paintMovesWithContent: () => true })).toBe(true);
  });
});
