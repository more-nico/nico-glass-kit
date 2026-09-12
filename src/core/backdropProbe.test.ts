import { describe, expect, it } from 'vitest';
import {
  compositeOver,
  decideLight,
  firstImageLayer,
  gradientColorAt,
  LIGHT_LUMINANCE_THRESHOLD,
  parseCssColor,
  parseGradient,
  relativeLuminance,
  resolvePointColor,
  type PaintLayer,
} from './backdropProbe';

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const PAGE_FALLBACK = WHITE;

function layer(partial: Partial<PaintLayer>): PaintLayer {
  return {
    box: { width: 100, height: 100 },
    point: { x: 50, y: 50 },
    backgroundColor: null,
    gradient: null,
    imageColor: null,
    ...partial,
  };
}

describe('parseCssColor', () => {
  it('parses hex forms', () => {
    expect(parseCssColor('#ffffff')).toEqual(WHITE);
    expect(parseCssColor('#0b0d14')).toEqual({ r: 11, g: 13, b: 20, a: 1 });
    expect(parseCssColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseCssColor('#ff7e5f80')).toEqual({ r: 255, g: 126, b: 95, a: 128 / 255 });
  });

  it('parses legacy comma syntax including the rgba alpha channel', () => {
    expect(parseCssColor('rgb(10, 12, 20)')).toEqual({ r: 10, g: 12, b: 20, a: 1 });
    expect(parseCssColor('rgba(10, 12, 20, 0.88)')).toEqual({
      r: 10,
      g: 12,
      b: 20,
      a: 0.88,
    });
  });

  it('parses modern space syntax with slash alpha', () => {
    expect(parseCssColor('rgb(18 20 26)')).toEqual({ r: 18, g: 20, b: 26, a: 1 });
    expect(parseCssColor('rgb(18 20 26 / 0.5)')).toEqual({ r: 18, g: 20, b: 26, a: 0.5 });
    const percent = parseCssColor('rgb(50% 100% 0% / 50%)')!;
    expect(percent.r).toBeCloseTo(127.5, 5);
    expect(percent.g).toBeCloseTo(255, 5);
    expect(percent.b).toBe(0);
    expect(percent.a).toBe(0.5);
  });

  it('parses transparent and rejects anything unpaintable', () => {
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor('none')).toBeNull();
    expect(parseCssColor('currentcolor')).toBeNull();
    expect(parseCssColor('url("x.png")')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('rgb(1 2)')).toBeNull();
  });
});

describe('relativeLuminance', () => {
  it('maps black to 0 and white to 1', () => {
    expect(relativeLuminance(BLACK)).toBe(0);
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 5);
  });

  it('weights mid-gray around 0.216', () => {
    expect(relativeLuminance({ r: 128, g: 128, b: 128, a: 1 })).toBeCloseTo(0.216, 2);
  });
});

describe('compositeOver', () => {
  it('lets an opaque front fully replace the back', () => {
    expect(compositeOver({ r: 255, g: 0, b: 0, a: 1 }, { r: 0, g: 255, b: 0, a: 1 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });

  it('composites translucent fronts onto the back', () => {
    const out = compositeOver({ r: 255, g: 0, b: 0, a: 0.5 }, BLACK);
    expect(out.a).toBe(1);
    expect(out.r).toBeCloseTo(127.5, 5);
    expect(out.g).toBe(0);
  });

  it('passes fully transparent fronts through', () => {
    expect(compositeOver({ r: 0, g: 0, b: 0, a: 0 }, WHITE)).toEqual(WHITE);
  });
});

describe('decideLight', () => {
  it('starts unbiased at the threshold', () => {
    expect(decideLight(LIGHT_LUMINANCE_THRESHOLD + 0.01, null)).toBe(true);
    expect(decideLight(LIGHT_LUMINANCE_THRESHOLD - 0.01, null)).toBe(false);
  });

  it('keeps the current mode inside the hysteresis band', () => {
    expect(decideLight(LIGHT_LUMINANCE_THRESHOLD - 0.02, true)).toBe(true);
    expect(decideLight(LIGHT_LUMINANCE_THRESHOLD - 0.05, true)).toBe(false);
    expect(decideLight(LIGHT_LUMINANCE_THRESHOLD + 0.02, false)).toBe(false);
    expect(decideLight(LIGHT_LUMINANCE_THRESHOLD + 0.05, false)).toBe(true);
  });
});

describe('parseGradient + gradientColorAt', () => {
  const box = { width: 100, height: 200 };

  it('evaluates a vertical linear gradient end to end', () => {
    const spec = parseGradient('linear-gradient(180deg, rgb(0 0 0), rgb(255 255 255))');
    expect(spec).not.toBeNull();
    expect(gradientColorAt(spec!, box, { x: 50, y: 0 })).toEqual(BLACK);
    expect(gradientColorAt(spec!, box, { x: 50, y: 200 })).toEqual(WHITE);
    const mid = gradientColorAt(spec!, box, { x: 50, y: 100 })!;
    expect(mid.r).toBeCloseTo(127.5, 5);
    expect(mid.a).toBe(1);
  });

  it('respects intermediate stop positions', () => {
    const spec = parseGradient(
      'linear-gradient(180deg, rgb(0 0 0) 0%, rgb(136 136 136) 55%, rgb(255 255 255) 100%)',
    )!;
    // t=0.275 on a 200px box → halfway into the 0..55% span → 50% of #888
    const c = gradientColorAt(spec, box, { x: 50, y: 55 })!;
    expect(c.r).toBeCloseTo(68, 0);
  });

  it('maps `to` keywords to angles', () => {
    const toTop = parseGradient('linear-gradient(to top, rgb(0 0 0), rgb(255 255 255))')!;
    expect(gradientColorAt(toTop, box, { x: 50, y: 200 })).toEqual(BLACK);
    expect(gradientColorAt(toTop, box, { x: 50, y: 0 })).toEqual(WHITE);
    // Corner keywords approximate the 45° diagonal of their quadrant.
    const toTopRight = parseGradient(
      'linear-gradient(to top right, rgb(0 0 0), rgb(255 255 255))',
    )!;
    expect(gradientColorAt(toTopRight, { width: 100, height: 100 }, { x: 0, y: 100 })).toEqual(
      BLACK,
    );
    expect(gradientColorAt(toTopRight, { width: 100, height: 100 }, { x: 100, y: 0 })).toEqual(
      WHITE,
    );
  });

  it('defaults the linear angle to 180deg', () => {
    const spec = parseGradient('linear-gradient(rgb(0 0 0), rgb(255 255 255))')!;
    expect(spec.kind).toBe('linear');
    expect(gradientColorAt(spec, box, { x: 50, y: 0 })).toEqual(BLACK);
  });

  it('evaluates radial gradients from the keyword centre outwards', () => {
    const spec = parseGradient(
      'radial-gradient(circle at 35% 35%, rgb(255 0 0), rgb(0 0 255))',
    )!;
    expect(spec.kind).toBe('radial');
    expect(gradientColorAt(spec, { width: 100, height: 100 }, { x: 35, y: 35 })).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
    expect(gradientColorAt(spec, { width: 100, height: 100 }, { x: 100, y: 100 })).toEqual({
      r: 0,
      g: 0,
      b: 255,
      a: 1,
    });
  });

  it('parses computed-style commas inside rgb() stops', () => {
    // The playground aurora blobs as the browser reports them.
    const spec = parseGradient(
      'radial-gradient(circle at 35% 35%, rgb(124, 58, 237), rgba(0, 0, 0, 0) 65%)',
    )!;
    // 29.87px out of the 91.92px farthest-corner radius → t = 0.325, the
    // midpoint of the 0..65% span. Premultiplied interpolation keeps the hue.
    const mid = gradientColorAt(spec, { width: 100, height: 100 }, { x: 35, y: 35 + 29.87 })!;
    expect(mid.r).toBeCloseTo(124, 0);
    expect(mid.g).toBeCloseTo(58, 0);
    expect(mid.b).toBeCloseTo(237, 0);
    expect(mid.a).toBeCloseTo(0.5, 2);
  });

  it('rejects non-gradient layers', () => {
    expect(parseGradient('url("data:image/png;base64,AAAA")')).toBeNull();
    expect(parseGradient('none')).toBeNull();
    expect(parseGradient('linear-gradient(rgb(0 0 0))')).toBeNull();
  });
});

describe('firstImageLayer', () => {
  it('extracts a megabyte data url as the first layer', () => {
    const url = `data:image/png;base64,${'A'.repeat(1_000_000)}`;
    const r = firstImageLayer(`url("${url}")`);
    expect(r).toEqual({ kind: 'url', url });
  });

  it('extracts unquoted and quoted urls, including commas inside quotes', () => {
    expect(firstImageLayer('url(a.png)')).toEqual({ kind: 'url', url: 'a.png' });
    expect(firstImageLayer(`url("b.png")`)).toEqual({ kind: 'url', url: 'b.png' });
    expect(firstImageLayer(`url("c,d.png")`)).toEqual({ kind: 'url', url: 'c,d.png' });
  });

  it('takes only the first layer of a multi-layer background', () => {
    expect(firstImageLayer('url(a.png), linear-gradient(rgb(0 0 0), rgb(255 255 255))')).toEqual({
      kind: 'url',
      url: 'a.png',
    });
  });

  it('returns a gradient layer for gradient-first backgrounds', () => {
    const layer = 'linear-gradient(rgb(255 0 0), rgb(0 0 255))';
    expect(firstImageLayer(layer)).toEqual({ kind: 'gradient', layer });
    expect(firstImageLayer(`${layer}, url(a.png)`)).toEqual({ kind: 'gradient', layer });
  });

  it('returns null for none, empty and unpaintable values', () => {
    expect(firstImageLayer('none')).toBeNull();
    expect(firstImageLayer('NONE')).toBeNull();
    expect(firstImageLayer('')).toBeNull();
    expect(firstImageLayer('cross-fade(url(a.png), white))')).toBeNull();
  });
});

describe('resolvePointColor', () => {
  it('returns the first opaque layer and stops walking', () => {
    const layers = [
      layer({ backgroundColor: WHITE }),
      layer({ backgroundColor: BLACK }),
    ];
    expect(resolvePointColor(layers, { r: 9, g: 9, b: 9, a: 1 })).toEqual(WHITE);
  });

  it('falls through unpainted layers to the page fallback', () => {
    const layers = [
      layer({ backgroundColor: { r: 0, g: 0, b: 0, a: 0 } }),
      layer({}),
    ];
    expect(resolvePointColor(layers, PAGE_FALLBACK)).toEqual(PAGE_FALLBACK);
  });

  it('composites translucent layers front to back', () => {
    const layers = [
      layer({ backgroundColor: { r: 255, g: 0, b: 0, a: 0.5 } }),
      layer({ backgroundColor: BLACK }),
    ];
    const out = resolvePointColor(layers, PAGE_FALLBACK);
    expect(out.r).toBeCloseTo(127.5, 5);
  });

  it('evaluates the gradient at the sample point', () => {
    const spec = parseGradient('linear-gradient(90deg, rgb(255 0 0), rgb(0 0 255))')!;
    const left = resolvePointColor(
      [layer({ gradient: spec, point: { x: 0, y: 5 } })],
      PAGE_FALLBACK,
    );
    const right = resolvePointColor(
      [layer({ gradient: spec, point: { x: 100, y: 5 } })],
      PAGE_FALLBACK,
    );
    expect(left).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(right).toEqual({ r: 0, g: 0, b: 255, a: 1 });
  });

  it('skips layers with a pending url() image but keeps their background-color', () => {
    const tinted = { r: 20, g: 22, b: 30, a: 0.2 };
    const layers = [
      layer({ backgroundColor: tinted }), // url() image pending → imageColor null
      layer({ backgroundColor: WHITE }),
    ];
    const out = resolvePointColor(layers, PAGE_FALLBACK);
    expect(out.r).toBeGreaterThan(200); // mostly white underneath the faint tint
  });

  it('paints a decoded image colour over the background-color', () => {
    const photo = { r: 240, g: 240, b: 240, a: 1 };
    const out = resolvePointColor(
      [layer({ imageColor: photo, backgroundColor: { r: 0, g: 0, b: 200, a: 1 } })],
      PAGE_FALLBACK,
    );
    expect(out).toEqual(photo);
  });

  it('blends a translucent remainder over the page fallback', () => {
    const out = resolvePointColor(
      [layer({ backgroundColor: { r: 0, g: 0, b: 0, a: 0.5 } })],
      WHITE,
    );
    expect(out.r).toBeCloseTo(127.5, 5);
    expect(out.a).toBe(1);
  });
});
