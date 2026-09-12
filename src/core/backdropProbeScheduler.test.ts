import { describe, expect, it } from 'vitest';
import { decideScrollProbe, isInternalMutation, isLightFlipMutation } from './backdropProbeScheduler';

/* ------------------------------------------------------------------ */
/* isInternalMutation                                                  */
/* ------------------------------------------------------------------ */

interface FakeElementOptions {
  /** Value of the nearest data-ngs-internal zone, null for none. */
  zone: string | null;
}

function fakeElement({ zone }: FakeElementOptions): Element {
  const zoneNode = zone === null ? null : { getAttribute: () => zone };
  return {
    closest: (selector: string) => (selector === '[data-ngs-internal]' ? zoneNode : null),
  } as unknown as Element;
}

function mutation(
  type: MutationRecordType,
  target: Element,
  attributeName?: string,
): MutationRecord {
  return { type, target, attributeName } as unknown as MutationRecord;
}

describe('isInternalMutation', () => {
  it('mutes style writes inside a layer zone', () => {
    const el = fakeElement({ zone: 'style' });
    expect(isInternalMutation(mutation('attributes', el, 'style'))).toBe(true);
  });

  it('lets class swaps and data-ngs-light flips through a layer zone', () => {
    const el = fakeElement({ zone: 'style' });
    expect(isInternalMutation(mutation('attributes', el, 'class'))).toBe(false);
    expect(isInternalMutation(mutation('attributes', el, 'data-ngs-light'))).toBe(false);
    expect(isInternalMutation(mutation('childList', el))).toBe(false);
  });

  it('mutes everything inside the registry zone', () => {
    const el = fakeElement({ zone: 'all' });
    expect(isInternalMutation(mutation('attributes', el, 'style'))).toBe(true);
    expect(isInternalMutation(mutation('attributes', el, 'scale'))).toBe(true);
    expect(isInternalMutation(mutation('attributes', el, 'class'))).toBe(true);
    expect(isInternalMutation(mutation('childList', el))).toBe(true);
  });

  it('lets page mutations through untouched', () => {
    const el = fakeElement({ zone: null });
    expect(isInternalMutation(mutation('attributes', el, 'style'))).toBe(false);
    expect(isInternalMutation(mutation('attributes', el, 'class'))).toBe(false);
    expect(isInternalMutation(mutation('childList', el))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* isLightFlipMutation                                                 */
/* ------------------------------------------------------------------ */

describe('isLightFlipMutation', () => {
  it('matches the data-ngs-light attribute flip', () => {
    const el = fakeElement({ zone: null });
    expect(isLightFlipMutation(mutation('attributes', el, 'data-ngs-light'))).toBe(true);
  });

  it('ignores other attributes and childList changes', () => {
    const el = fakeElement({ zone: null });
    expect(isLightFlipMutation(mutation('attributes', el, 'style'))).toBe(false);
    expect(isLightFlipMutation(mutation('attributes', el, 'class'))).toBe(false);
    expect(isLightFlipMutation(mutation('childList', el))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* decideScrollProbe                                                   */
/* ------------------------------------------------------------------ */

const RECT = { top: 100, left: 200, width: 80, height: 40 };
const DOC = { id: 'document' };

function decide(input: Partial<Parameters<typeof decideScrollProbe>[0]>): boolean {
  const {
    rect = RECT,
    last = null,
    offsets = new Map(),
    intersects = () => true,
  } = input;
  return decideScrollProbe({ rect, last, offsets, intersects });
}

describe('decideScrollProbe', () => {
  it('does nothing when no scroller moved', () => {
    expect(decide({ offsets: new Map() })).toBe(false);
  });

  it('probes a first-seen scroller only when it overlaps the element', () => {
    const offsets = new Map([[DOC, { top: 10, left: 0 }]]);
    expect(decide({ offsets, intersects: () => true })).toBe(true);
    expect(decide({ offsets, intersects: () => false })).toBe(false);
  });

  it('skips scrollers that did not move since the baseline', () => {
    const last = {
      rect: RECT,
      offsets: new Map([[DOC, { top: 10, left: 0 }]]),
    };
    expect(decide({ last, offsets: new Map([[DOC, { top: 10, left: 0 }]]) })).toBe(false);
  });

  it('skips elements that moved along with the scrolled content', () => {
    const last = {
      rect: { top: 100, left: 200, width: 80, height: 40 },
      offsets: new Map([[DOC, { top: 0, left: 0 }]]),
    };
    // Document scrolled down 40, element moved down exactly 40: in-flow.
    const rect = { top: 140, left: 200, width: 80, height: 40 };
    expect(
      decide({
        rect,
        last,
        offsets: new Map([[DOC, { top: 40, left: 0 }]]),
      }),
    ).toBe(false);
  });

  it('probes anchored elements over a scrolling overlapping scroller', () => {
    const last = {
      rect: RECT,
      offsets: new Map([[DOC, { top: 0, left: 0 }]]),
    };
    // Element stayed put (fixed) while the document scrolled.
    expect(
      decide({
        rect: RECT,
        last,
        offsets: new Map([[DOC, { top: 40, left: 0 }]]),
        intersects: () => true,
      }),
    ).toBe(true);
  });

  it('skips anchored elements when the scroller is elsewhere', () => {
    const last = {
      rect: RECT,
      offsets: new Map([[DOC, { top: 0, left: 0 }]]),
    };
    expect(
      decide({
        rect: RECT,
        last,
        offsets: new Map([[DOC, { top: 40, left: 0 }]]),
        intersects: () => false,
      }),
    ).toBe(false);
  });

  it('probes conservatively when the rect changed beyond a translation', () => {
    const last = {
      rect: RECT,
      offsets: new Map([[DOC, { top: 0, left: 0 }]]),
    };
    // Size changed (layout shift): not moved-with, not anchored.
    const rect = { top: 110, left: 200, width: 120, height: 40 };
    expect(
      decide({
        rect,
        last,
        offsets: new Map([[DOC, { top: 40, left: 0 }]]),
        intersects: () => false,
      }),
    ).toBe(true);
  });
});
