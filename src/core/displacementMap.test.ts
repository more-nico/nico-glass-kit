import { beforeEach, describe, expect, it } from 'vitest';
import {
  clampLensMapRasterScale,
  clearLensMapCache,
  computeLensPixels,
  generateLensMap,
  lensMapCacheKey,
  lensMapCacheStats,
  lensMapRasterSize,
  renderPixelsToDataUrl,
  setLensMapObserver,
  DEFAULT_LENS_MAP_RASTER_SCALE,
  MAX_LENS_MAP_RASTER_SCALE,
  MAX_DISPLACEMENT_PX,
  MIN_LENS_MAP_RASTER_SCALE,
} from './displacementMap';

const BASE = { width: 200, height: 120, radius: 40, edge: 10, curvature: 0.49, strength: 1 };

describe('computeLensPixels', () => {
  const pixels = computeLensPixels(BASE);
  const px = (x: number, y: number) => {
    const i = (y * 200 + x) * 4;
    return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
  };

  it('is neutral (128) in the flat interior and keeps B=128, A=255 everywhere', () => {
    const c = px(100, 60);
    expect(c.r).toBe(128);
    expect(c.g).toBe(128);
    expect(c.b).toBe(128);
    expect(c.a).toBe(255);

    for (let i = 2; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(128);
      expect(pixels[i + 1]).toBe(255);
    }
  });

  it('displaces horizontally near the left/right edges with mirrored signs', () => {
    const y = 60; // mid height, straight-edge region
    let right = { r: 128, g: 128 };
    let left = { r: 128, g: 128 };
    for (let d = 2; d < 30; d++) {
      const pr = px(200 - 1 - d, y);
      const pl = px(d, y);
      if (Math.abs(pr.r - 128) > Math.abs(right.r - 128)) right = pr;
      if (Math.abs(pl.r - 128) > Math.abs(left.r - 128)) left = pl;
    }
    expect(Math.abs(right.r - 128)).toBeGreaterThan(4);
    expect(right.r - 128).toBeCloseTo(-(left.r - 128), 0);
    expect(right.g).toBe(128);
  });

  it('displaces vertically near the top edge and mirrors across the horizontal axis', () => {
    const top = px(100, 4);
    const bottom = px(100, 120 - 1 - 4);
    expect(Math.abs(top.g - 128)).toBeGreaterThan(4);
    expect(top.g - 128).toBeCloseTo(-(bottom.g - 128), 0);
    expect(top.r).toBe(128);
  });

  it('produces radial displacement at the corner arc', () => {
    let found = false;
    for (let y = 0; y < 44 && !found; y++) {
      for (let x = 156; x < 200 && !found; x++) {
        const p = px(x, y);
        if (Math.abs(p.r - 128) > 2 && Math.abs(p.g - 128) > 2) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('strength 0 folds entirely into maxScale (scale attribute, not pixels)', () => {
    const result = generateLensMap({ ...BASE, strength: 0, skipDataUrl: true });
    expect(result.maxScale).toBe(0);
  });

  it('curvature shifts the profile between bucket and squircle', () => {
    const bucket = computeLensPixels({ ...BASE, curvature: 0 });
    const squircle = computeLensPixels({ ...BASE, curvature: 1 });
    // same straight-edge sample: the two profiles must differ
    const bR = bucket[((60 * 200) + (200 - 1 - 6)) * 4];
    const sR = squircle[((60 * 200) + (200 - 1 - 6)) * 4];
    expect(bR).not.toBe(sR);
  });
});

describe('lensMapRasterSize', () => {
  it('applies the default scale, rounded, with a 1 px floor', () => {
    expect(lensMapRasterSize(400, 240)).toEqual({
      width: Math.round(400 * DEFAULT_LENS_MAP_RASTER_SCALE),
      height: Math.round(240 * DEFAULT_LENS_MAP_RASTER_SCALE),
    });
    expect(lensMapRasterSize(3, 5)).toEqual({ width: 1, height: 1 });
    expect(lensMapRasterSize(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('honours an explicit scale and clamps it to the supported range', () => {
    expect(lensMapRasterSize(400, 240, 0.25)).toEqual({ width: 100, height: 60 });
    expect(lensMapRasterSize(400, 240, 1)).toEqual({
      width: Math.round(400 * MAX_LENS_MAP_RASTER_SCALE),
      height: Math.round(240 * MAX_LENS_MAP_RASTER_SCALE),
    });
    expect(lensMapRasterSize(400, 240, 0)).toEqual({
      width: Math.round(400 * MIN_LENS_MAP_RASTER_SCALE),
      height: Math.round(240 * MIN_LENS_MAP_RASTER_SCALE),
    });
  });
});

describe('clampLensMapRasterScale', () => {
  it('defaults to 0.2 and clamps into [0.1, 0.5]', () => {
    expect(clampLensMapRasterScale(0.8)).toBe(MAX_LENS_MAP_RASTER_SCALE);
    expect(clampLensMapRasterScale(0.25)).toBe(0.25);
    expect(clampLensMapRasterScale(0.01)).toBe(MIN_LENS_MAP_RASTER_SCALE);
    expect(clampLensMapRasterScale(undefined)).toBe(DEFAULT_LENS_MAP_RASTER_SCALE);
    expect(clampLensMapRasterScale(Number.NaN)).toBe(DEFAULT_LENS_MAP_RASTER_SCALE);
  });
});

describe('renderPixelsToDataUrl', () => {
  it('returns no data URL without a DOM canvas (SSR / node)', () => {
    expect(renderPixelsToDataUrl(computeLensPixels(BASE), 200, 120)).toBe('');
  });
});

describe('generateLensMap', () => {
  beforeEach(() => {
    clearLensMapCache();
    setLensMapObserver(null);
  });

  it('folds the strength into maxScale = strength * 24 * (255/127)', () => {
    const result = generateLensMap({ ...BASE, skipDataUrl: true });
    expect(result.maxScale).toBeCloseTo(MAX_DISPLACEMENT_PX * (255 / 127), 6);

    const half = generateLensMap({ ...BASE, strength: 0.5, skipDataUrl: true });
    expect(half.maxScale).toBeCloseTo(0.5 * MAX_DISPLACEMENT_PX * (255 / 127), 6);
  });

  it('caches by shape and reports hit/miss stats', () => {
    const before = lensMapCacheStats();
    const first = generateLensMap({ ...BASE, skipDataUrl: true });
    const second = generateLensMap({ ...BASE, skipDataUrl: true });
    expect(second).toBe(first);
    const after = lensMapCacheStats();
    expect(after.misses - before.misses).toBe(1);
    expect(after.hits - before.hits).toBe(1);
    expect(after.generated - before.generated).toBe(1);
  });

  it('does not share the cache across different shapes', () => {
    const before = lensMapCacheStats();
    generateLensMap({ ...BASE, radius: 20, skipDataUrl: true });
    generateLensMap({ ...BASE, edge: 16, skipDataUrl: true });
    generateLensMap({ ...BASE, curvature: 0.9, skipDataUrl: true });
    const after = lensMapCacheStats();
    expect(after.generated - before.generated).toBe(3);
  });

  it('evicts the oldest entry beyond the 32-entry LRU limit', () => {
    for (let i = 0; i < 40; i++) {
      generateLensMap({ ...BASE, width: 200 + i, height: 120, radius: 40, edge: 10, curvature: 0.5, strength: 1, skipDataUrl: true });
    }
    const stats = lensMapCacheStats();
    expect(stats.size).toBeLessThanOrEqual(32);
    expect(stats.evictions).toBeGreaterThan(0);
  });

  it('keys include the dpr quality', () => {
    const a = lensMapCacheKey({ ...BASE });
    const b = lensMapCacheKey({ ...BASE, dpr: 2 });
    expect(a).not.toBe(b);
  });

  it('keys include the map raster scale', () => {
    const a = lensMapCacheKey({ ...BASE });
    const b = lensMapCacheKey({ ...BASE, rasterScale: 0.25 });
    expect(a).not.toBe(b);
  });

  it('notifies the observer only on misses', () => {
    const seen: number[] = [];
    setLensMapObserver((result) => seen.push(result.pixelWidth));
    generateLensMap({ ...BASE, skipDataUrl: true });
    generateLensMap({ ...BASE, skipDataUrl: true });
    expect(seen).toHaveLength(1);
  });

  it('normalises pixel size by quality', () => {
    const result = generateLensMap({ ...BASE, dpr: 2, skipDataUrl: true });
    expect(result.pixelWidth).toBe(400);
    expect(result.pixelHeight).toBe(240);
    expect(result.width).toBe(200);
    expect(result.height).toBe(120);
  });

  it('keeps the pixel buffer full-size and records the raster scale', () => {
    const result = generateLensMap({ ...BASE, dpr: 2, rasterScale: 0.25, skipDataUrl: true });
    expect(result.pixelWidth).toBe(400);
    expect(result.pixelHeight).toBe(240);
    expect(result.rasterScale).toBe(0.25);
    expect(result.dataUrl).toBe('');
  });
});
