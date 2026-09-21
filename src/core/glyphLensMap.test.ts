import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLensPixels, generateLensMap } from './displacementMap';
import {
  clearGlyphRasterCache,
  computeGlyphLensPixels,
  generateGlyphRaster,
  glyphRasterCacheKey,
  glyphRasterCacheStats,
  glyphRingAlpha,
  layoutGlyphs,
  measureTextMetrics,
  setGlyphRasterObserver,
  signedDistanceField,
  type GlyphMetrics,
  type GlyphRasterOptions,
} from './glyphLensMap';

/** Solid coverage raster. */
function solid(width: number, height: number, alpha = 255): Uint8ClampedArray {
  const coverage = new Uint8ClampedArray(width * height);
  coverage.fill(alpha);
  return coverage;
}

/** Coverage with a solid rectangle at [left, right) × [top, bottom). */
function block(
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Uint8ClampedArray {
  const coverage = new Uint8ClampedArray(width * height);
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) coverage[y * width + x] = 255;
  }
  return coverage;
}

function firstDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

const rectPixel = (pixels: Uint8ClampedArray, width: number, x: number, y: number) => {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
};

describe('signedDistanceField', () => {
  it('is negative inside and positive outside, half a pixel off the boundary', () => {
    const coverage = solid(20, 20);
    const sdf = signedDistanceField(coverage, 20, 20);
    expect(sdf[0]).toBeCloseTo(-0.5, 6);
    expect(sdf[10 * 20 + 10]).toBeCloseTo(-9.5, 6);

    // A 6×6 block inside a 20×20 raster: outside pixels measure the distance
    // to the nearest inside pixel minus the half-pixel boundary offset.
    const island = signedDistanceField(block(20, 20, 7, 7, 13, 13), 20, 20);
    expect(island[0]).toBeCloseTo(Math.hypot(7, 7) - 0.5, 6);
    expect(island[10 * 20 + 6]).toBeCloseTo(0.5, 6);
    expect(island[10 * 20 + 10]).toBeCloseTo(-2.5, 6);
  });

  it('treats the raster border as outside even for a fully covered raster', () => {
    const sdf = signedDistanceField(solid(3, 3), 3, 3);
    expect(sdf[1 * 3 + 1]).toBeCloseTo(-1.5, 6);
    expect(Array.from(sdf).every((value) => value < 0)).toBe(true);
  });
});

describe('computeGlyphLensPixels', () => {
  const SIZE = 200;

  it('matches the rectangle path pixel-for-pixel for a solid square', () => {
    const coverage = solid(SIZE, SIZE);
    const options = {
      width: SIZE,
      height: SIZE,
      edge: 10,
      curvature: 0.49,
      strength: 1,
      quality: 1,
    };
    const glyph = computeGlyphLensPixels(coverage, options);
    const rect = computeLensPixels({
      width: SIZE,
      height: SIZE,
      radius: 0,
      edge: options.edge,
      curvature: options.curvature,
      strength: options.strength,
      dpr: 1,
    });

    const difference = firstDifference(glyph.pixels, rect);
    expect(difference, `first differing pixel index ${difference}`).toBe(-1);
    expect(glyph.maxScale).toBeCloseTo(1 * 24 * (255 / 127), 6);
    expect(glyph.strengthUsed).toBe(1);
  });

  it.each([2, 6, 20])('matches a narrow rectangular surface of width %i at both DPRs', (width) => {
    for (const quality of [1, 2]) for (const edge of [0, 8, 24]) {
      const options = { width, height: 40, radius: 0, edge, curvature: 0.2, strength: 0.7, quality, skipDataUrl: true };
      const rectangle = generateLensMap(options);
      const glyph = computeGlyphLensPixels(solid(width * quality, 40 * quality), {
        ...options, width: width * quality, height: 40 * quality,
      });
      expect(firstDifference(glyph.pixels, rectangle.pixels)).toBe(-1);
      expect(glyph.maxScale).toBe(rectangle.maxScale);
    }
  });

  it('refracts away from a hole and keeps its interior neutral', () => {
    const coverage = solid(40, 40);
    for (let y = 12; y < 28; y++) for (let x = 12; x < 28; x++) coverage[y * 40 + x] = 0;
    const result = computeGlyphLensPixels(coverage, { width: 40, height: 40, edge: 8, curvature: 0.2, strength: 1 });
    expect(rectPixel(result.pixels, 40, 11, 20).r).toBeLessThan(128);
    expect(rectPixel(result.pixels, 40, 28, 20).r).toBeGreaterThan(128);
    expect(rectPixel(result.pixels, 40, 20, 20).r).toBe(128);
    expect(result.sdf[20 * 40 + 20]).toBeGreaterThan(0);
  });

  it('keeps disconnected punctuation at full strength and turns displacement off at zero', () => {
    const coverage = block(20, 40, 8, 4, 12, 8);
    for (let y = 30; y < 34; y++) for (let x = 8; x < 12; x++) coverage[y * 20 + x] = 255;
    const options = { width: 20, height: 40, edge: 8, curvature: 0.2, strength: 1 };
    const result = computeGlyphLensPixels(coverage, options);
    expect(rectPixel(result.pixels, 20, 8, 6)).toEqual(rectPixel(result.pixels, 20, 8, 32));
    expect(result.maxScale).toBeCloseTo(24 * 255 / 127);
    expect(computeGlyphLensPixels(coverage, { ...options, strength: 0 }).maxScale).toBe(0);
  });

  it('keeps B=128, A=255 and stays neutral in the interior and outside the glyph', () => {
    const coverage = block(40, 40, 12, 12, 28, 28);
    const { pixels } = computeGlyphLensPixels(coverage, {
      width: 40,
      height: 40,
      edge: 4,
      curvature: 0.2,
      strength: 1,
      quality: 1,
    });

    for (let i = 2; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(128);
      expect(pixels[i + 1]).toBe(255);
    }

    // Glyph centre (flat interior) and the raster corner (outside) are neutral.
    const centre = rectPixel(pixels, 40, 20, 20);
    expect(centre).toEqual({ r: 128, g: 128, b: 128, a: 255 });
    const corner = rectPixel(pixels, 40, 0, 0);
    expect(corner).toEqual({ r: 128, g: 128, b: 128, a: 255 });
  });

  it('displaces inward at straight edges and mirrors across the vertical axis', () => {
    // A full-height bar: the left and right rims of the bar must mirror.
    const coverage = block(60, 60, 20, 0, 40, 60);
    const { pixels } = computeGlyphLensPixels(coverage, {
      width: 60,
      height: 60,
      edge: 5,
      curvature: 0.2,
      strength: 1,
      quality: 1,
    });

    const left = rectPixel(pixels, 60, 20, 30);
    const right = rectPixel(pixels, 60, 39, 30);
    expect(left.r - 128).toBeGreaterThan(4);
    expect(left.r - 128).toBeCloseTo(-(right.r - 128), 0);
    expect(left.g).toBe(128);
    expect(right.g).toBe(128);
    expect(left.r).toBe(rectPixel(pixels, 60, 20, 10).r);
  });

  it('preserves the material band and displacement for thin strokes', () => {
    // 6 px wide bar: half-stroke = 2.5 physical px.
    const coverage = block(40, 40, 17, 0, 23, 40);
    const result = computeGlyphLensPixels(coverage, {
      width: 40,
      height: 40,
      edge: 10,
      curvature: 0.2,
      strength: 1,
      quality: 1,
    });

    expect(result.maxInside).toBeCloseTo(2.5, 6);
    expect(result.edgeUsed).toBe(10);
    expect(result.strengthUsed).toBe(1);
    expect(result.maxScale).toBeCloseTo(24 * (255 / 127), 6);
  });

  it('lets thick strokes keep the full band and amplitude', () => {
    const result = computeGlyphLensPixels(solid(120, 120), {
      width: 120,
      height: 120,
      edge: 10,
      curvature: 0.2,
      strength: 1,
      quality: 1,
    });
    expect(result.maxInside).toBeCloseTo(59.5, 6);
    expect(result.edgeUsed).toBe(10);
    expect(result.strengthUsed).toBe(1);
  });

  it('scales the band by quality (dpr) like the rectangle path', () => {
    const coverage = solid(40, 40);
    const atOne = computeGlyphLensPixels(coverage, {
      width: 40,
      height: 40,
      edge: 5,
      curvature: 0.2,
      strength: 1,
      quality: 1,
    });
    const atTwo = computeGlyphLensPixels(coverage, {
      width: 40,
      height: 40,
      edge: 5,
      curvature: 0.2,
      strength: 1,
      quality: 2,
    });
    expect(atOne.edgeUsed).toBe(5);
    expect(atTwo.edgeUsed).toBe(10);
  });
});

describe('glyphRingAlpha', () => {
  it('feathers from the contour into the glyph without painting outside', () => {
    const distances = new Float32Array([0.5, -0.5, -1.5, -2.5, -3.5]);
    const ring = glyphRingAlpha(distances, 5, 1, 3, true);
    expect(Array.from(ring)).toEqual([0, 236, 128, 19, 0]);
    expect(Array.from(glyphRingAlpha(distances, 5, 1, 0, true))).toEqual([0, 0, 0, 0, 0]);
  });

  it('keeps the feather profile in CSS units across DPRs', () => {
    const cssDistances = [-0.25, -0.75, -1.25, -2.75];
    const atOne = glyphRingAlpha(new Float32Array(cssDistances), 4, 1, 3, true);
    const atTwo = glyphRingAlpha(new Float32Array(cssDistances.map(d => d * 2)), 4, 1, 6, true);
    expect(atTwo).toEqual(atOne);
  });

  it('separates the 1px static border from the 2px pointer glint', () => {
    const sdf = signedDistanceField(solid(20, 20), 20, 20);
    const border = glyphRingAlpha(sdf, 20, 20, 1);
    const glint = glyphRingAlpha(sdf, 20, 20, 2);
    expect(border[10]).toBe(255);
    expect(border[30]).toBe(0);
    expect(glint[10]).toBe(255);
    expect(glint[30]).toBe(255);
    expect(glint[50]).toBe(0);
  });

  it('paints the requested inner border width', () => {
    const sdf = signedDistanceField(solid(20, 20), 20, 20);
    const ring = glyphRingAlpha(sdf, 20, 20, 3);
    expect(ring[0]).toBe(255); // sd = -0.5
    expect(ring[1 * 20 + 10]).toBe(255); // sd = -1.5
    expect(ring[2 * 20 + 10]).toBe(255); // sd = -2.5
    expect(ring[10 * 20 + 10]).toBe(0); // deep inside
  });

  it('does not paint outside the outline', () => {
    const sdf = signedDistanceField(block(20, 20, 7, 7, 13, 13), 20, 20);
    const ring = glyphRingAlpha(sdf, 20, 20, 2);
    expect(ring[10 * 20 + 6]).toBe(0); // sd = +0.5
    expect(ring[10 * 20 + 5]).toBe(0); // sd = +1.5
    expect(ring[0]).toBe(0);
  });
});

describe('layoutGlyphs', () => {
  const metrics: GlyphMetrics[] = [
    { advance: 10, inkLeft: 0, inkRight: 8, inkTop: -10, inkBottom: 0 },
    { advance: 5, inkLeft: 1, inkRight: 3, inkTop: -2, inkBottom: 2 },
    { advance: 6, inkLeft: 2, inkRight: 8, inkTop: -10, inkBottom: 0 },
    { advance: 4, inkLeft: 0, inkRight: 0, inkTop: 0, inkBottom: 0 },
  ];

  it('advances characters, tiles ink boxes and keeps blank glyphs out', () => {
    const layout = layoutGlyphs('0:1 ', metrics, 2, false, { ascent: 12, descent: 4, padding: 3 });
    expect(layout.width).toBe(10 + 5 + 6 + 4 + 2 * 3);
    expect(layout.height).toBe(16);
    expect(layout.baseline).toBe(12);
    expect(layout.glyphs).toHaveLength(3);

    const first = layout.glyphs[0];
    expect(first.char).toBe('0');
    expect(first).toMatchObject({ x: -3, y: -1, width: 14, height: 16, penX: 3, baseline: 13 });

    const colon = layout.glyphs[1];
    expect(colon).toMatchObject({ x: 10, y: 7, width: 8, height: 10, penX: 2, baseline: 5 });

    // The blank glyph still advances the pen.
    const last = layout.glyphs[2];
    expect(last.x).toBe(19 + 2 - 3);
  });

  it('widens digits to the widest digit advance with tabularNums', () => {
    const proportional = layoutGlyphs('0:1', metrics, 0, false);
    const tabular = layoutGlyphs('0:1', metrics, 0, true);
    expect(proportional.width).toBe(10 + 5 + 6);
    expect(tabular.width).toBe(10 + 5 + 10);
    expect(tabular.glyphs[2].x).toBe(15 + 2 - 3);
  });

  it('keeps clock width stable using the font-wide digit advance', () => {
    const narrow = { advance: 4, inkLeft: -1, inkRight: 3, inkTop: -10, inkBottom: 2 };
    const wide = { ...narrow, advance: 9, inkRight: 9 };
    const options = { digitAdvance: 11, ascent: 12, descent: 4 };
    expect(layoutGlyphs('11', [narrow, narrow], -2, true, options).width)
      .toBe(layoutGlyphs('88', [wide, wide], -2, true, options).width);
    // Italic ink outside the advance is retained in the tile.
    expect(layoutGlyphs('1', [narrow], 0, true, options).glyphs[0].x).toBe(-4);
  });

  it('derives the line box from the ink boxes when no ascent/descent is given', () => {
    const layout = layoutGlyphs('0:', metrics, 0, false);
    expect(layout.baseline).toBe(10);
    expect(layout.height).toBe(12);
  });

  it('handles an empty string', () => {
    const layout = layoutGlyphs('', [], 4, true);
    expect(layout).toEqual({ width: 0, height: 0, baseline: 0, glyphs: [] });
  });
});

class FakeContext {
  font = '';
  fillStyle = '';
  textAlign = '';
  textBaseline = '';
  imageSmoothingEnabled = false;
  imageSmoothingQuality = 'low';
  scale(): void {}
  fillText(): void {}
  drawImage(): void {}
  putImageData(): void {}
  measureText(text: string): TextMetrics {
    return {
      width: text.length * 10,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 10,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 3,
    } as TextMetrics;
  }
  getImageData(_x: number, _y: number, width: number, height: number): ImageData {
    // Every glyph is a solid block in the fake canvas.
    return {
      data: new Uint8ClampedArray(width * height * 4).fill(255),
      width,
      height,
    } as ImageData;
  }
  createImageData(width: number, height: number): ImageData {
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
    } as ImageData;
  }
  toDataURL(): string {
    return 'data:image/png;base64,fake';
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  private readonly ctx = new FakeContext();
  getContext(): FakeContext {
    return this.ctx;
  }
  toDataURL(): string {
    return 'data:image/png;base64,fake';
  }
}

class FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}

const RASTER: GlyphRasterOptions = {
  char: 'A',
  font: '700 48px "Fake Sans"',
  width: 40,
  height: 60,
  penX: 3,
  baseline: 50,
  depth: 8,
  curvature: 0.2,
  refraction: 1,
  dpr: 1,
};

describe('glyph rasterisation (fake canvas)', () => {
  beforeAll(() => {
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    clearGlyphRasterCache();
    setGlyphRasterObserver(null);
  });

  it('measures advances and ink boxes from the canvas', () => {
    const metrics = measureTextMetrics('AB', '48px "Fake Sans"');
    expect(metrics).not.toBeNull();
    expect(metrics?.width).toBe(20);
    expect(metrics?.glyphs).toHaveLength(2);
    expect(metrics?.glyphs[0]).toEqual({
      advance: 10,
      inkLeft: 0,
      inkRight: 10,
      inkTop: -8,
      inkBottom: 2,
    });
    expect(metrics?.ascent).toBe(10);
    expect(metrics?.descent).toBe(3);
  });

  it('rasterises mask, ring and map data URLs', () => {
    const raster = generateGlyphRaster(RASTER);
    expect(raster).not.toBeNull();
    expect(raster?.maskUrl).toBe('data:image/png;base64,fake');
    expect(raster?.ringUrl).toBe('data:image/png;base64,fake');
    expect(raster?.mapUrl).toBe('data:image/png;base64,fake');
    expect(raster?.width).toBe(40);
    expect(raster?.height).toBe(60);
    expect(raster?.pixelWidth).toBe(40);
    expect(raster?.pixelHeight).toBe(60);
    // Stroke width does not change the material amplitude.
    expect(raster?.edgeUsed).toBe(8);
    expect(raster?.maxInside).toBeCloseTo(19.5, 6);
    expect(raster?.scale).toBeCloseTo(24 * (255 / 127), 6);
  });

  it('returns null without caching when PNG generation fails, then recovers', () => {
    const failing = vi.spyOn(FakeCanvas.prototype, 'toDataURL').mockImplementation(() => { throw new Error('canvas unavailable'); });
    expect(generateGlyphRaster(RASTER)).toBeNull();
    expect(glyphRasterCacheStats().size).toBe(0);
    failing.mockRestore();
    expect(generateGlyphRaster(RASTER)?.mapUrl).toBeTruthy();
  });

  it('measures every digit even when the current text contains only ones', () => {
    const measured = vi.spyOn(FakeContext.prototype, 'measureText');
    expect(measureTextMetrics('11', '48px Fake', true)?.digitAdvance).toBe(10);
    for (const digit of '0123456789') expect(measured).toHaveBeenCalledWith(digit);
    measured.mockRestore();
  });

  it('scales the raster by dpr', () => {
    const raster = generateGlyphRaster({ ...RASTER, dpr: 2 });
    expect(raster?.pixelWidth).toBe(80);
    expect(raster?.pixelHeight).toBe(120);
    expect(raster?.edgeUsed).toBe(16);
  });

  it('caches by key and only notifies the observer on real rasterisations', () => {
    const seen: string[] = [];
    setGlyphRasterObserver((raster) => seen.push(raster.key));
    const before = glyphRasterCacheStats();

    const first = generateGlyphRaster(RASTER);
    const second = generateGlyphRaster(RASTER);
    expect(second).toBe(first);

    const after = glyphRasterCacheStats();
    expect(after.misses - before.misses).toBe(1);
    expect(after.hits - before.hits).toBe(1);
    expect(after.generated - before.generated).toBe(1);
    expect(seen).toEqual([first?.key]);

    // A different character is a different raster.
    generateGlyphRaster({ ...RASTER, char: 'B' });
    expect(seen).toHaveLength(2);
    expect(glyphRasterCacheKey({ ...RASTER, char: 'B' })).not.toBe(glyphRasterCacheKey(RASTER));
  });
});
