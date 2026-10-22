import { afterEach, expect, it, vi } from 'vitest';
import { backdropImageCacheStats, probeBackdropLight } from './backdropProbe';

interface FakeStyle {
  backgroundColor: string;
  backgroundImage: string;
  backgroundSize: string;
  backgroundPosition: string;
  visibility: string;
  display: string;
}

const BASE_STYLE: FakeStyle = {
  backgroundColor: 'rgb(255 255 255)',
  backgroundImage: 'none',
  backgroundSize: 'auto',
  backgroundPosition: '0% 0%',
  visibility: 'visible',
  display: 'block',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('pre-registers all nine exact cover samples so LRU eviction does not redecode', () => {
  vi.useFakeTimers();
  let imageCreates = 0;
  const context = {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([255, 255, 255, 255]) }),
  };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => context) };
  const styles = new WeakMap<object, FakeStyle>();
  let currentStack: unknown[] = [];

  const doc = {
    defaultView: null as unknown,
    body: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
    documentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) },
    createElement: vi.fn((tag: string) => (tag === 'canvas' ? canvas : {})),
    elementsFromPoint: vi.fn(() => currentStack),
  };
  const win = {
    innerWidth: 800,
    innerHeight: 600,
    setTimeout,
    clearTimeout,
    getComputedStyle: vi.fn((node: object) => styles.get(node) ?? BASE_STYLE),
  };
  doc.defaultView = win;
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);

  class FakeImage {
    naturalWidth = 32;
    naturalHeight = 32;
    crossOrigin = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private source = '';

    constructor() {
      imageCreates++;
    }

    get src(): string {
      return this.source;
    }

    set src(value: string) {
      this.source = value;
      this.onload?.();
    }
  }
  vi.stubGlobal('Image', FakeImage);

  function target(url: string) {
    const rect = { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 };
    const paint = {
      tagName: 'DIV',
      isConnected: true,
      getAttribute: () => null,
      getBoundingClientRect: () => rect,
    };
    const html = {
      tagName: 'HTML',
      getAttribute: () => null,
      getBoundingClientRect: () => rect,
    };
    const el = {
      tagName: 'DIV',
      isConnected: true,
      ownerDocument: doc,
      contains: () => false,
      getBoundingClientRect: () => rect,
    };
    styles.set(paint, {
      ...BASE_STYLE,
      backgroundColor: 'transparent',
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    });
    currentStack = [el, paint, html];
    return el as unknown as HTMLElement;
  }

  const targetEl = target('data:image/svg+xml,target');
  const first = probeBackdropLight(targetEl);
  expect(first?.pendingImages).toBe(true);
  expect(imageCreates).toBe(1);

  // Force the target's decoded URL out of the 32-entry LRU while its per-node
  // exact samples remain alive.
  for (let index = 0; index < 34; index++) {
    const el = target(`data:image/svg+xml,other-${index}`);
    expect(probeBackdropLight(el)).not.toBeNull();
  }
  expect(backdropImageCacheStats().evictions).toBeGreaterThan(0);

  const before = imageCreates;
  const second = probeBackdropLight(targetEl);
  expect(second?.pendingImages).toBe(false);
  expect(second?.averageLuminance).toBeCloseTo(1, 5);
  // All nine keys were filled by the first decode; no new Image is created.
  expect(imageCreates).toBe(before);
});
