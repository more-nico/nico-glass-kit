import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearLensMapCache,
  LENS_MAP_IMAGE_CACHE_BYTES,
  LENS_MAP_IMAGE_CACHE_LIMIT,
  lensDisplacementScale,
  lensMapCacheEpoch,
  lensMapImageCacheKey,
  lensMapImageCacheStats,
  lookupLensMapImage,
  retainLensMapImage,
  type LensMapImage,
  type LensMapOptions,
} from './displacementMap';

const BASE: LensMapOptions = {
  width: 200,
  height: 120,
  radius: 40,
  edge: 10,
  curvature: 0.49,
  strength: 1,
  dpr: 2,
  rasterScale: 0.2,
};

function image(options: LensMapOptions, url = 'data:image/png;base64,lens'): LensMapImage {
  return {
    cacheKey: lensMapImageCacheKey(options),
    width: options.width,
    height: options.height,
    pixelWidth: Math.round(options.width * (options.dpr ?? 1)),
    pixelHeight: Math.round(options.height * (options.dpr ?? 1)),
    quality: options.dpr ?? 1,
    rasterScale: options.rasterScale ?? 0.2,
    maxScale: lensDisplacementScale(options.strength),
    dataUrl: url,
  };
}

describe('rounded lens cache split', () => {
  beforeEach(() => {
    clearLensMapCache();
  });

  it('returns a cached worker image synchronously with the requested strength scale', () => {
    const options = { ...BASE, strength: 0.4 };
    const stored = image(options);
    retainLensMapImage(stored, options);

    const found = lookupLensMapImage({ ...options, strength: 0.75 });
    expect(found?.dataUrl).toBe(stored.dataUrl);
    expect(found?.dataUrl).toBe('data:image/png;base64,lens');
    expect(found?.maxScale).toBeCloseTo(lensDisplacementScale(0.75), 6);
    expect(found?.width).toBe(BASE.width);
  });

  it('drops worker results from before a cache clear', () => {
    const staleEpoch = lensMapCacheEpoch();
    const options = { ...BASE, strength: 0.4 };
    const stale = image(options);
    clearLensMapCache();
    retainLensMapImage(stale, options, staleEpoch);

    expect(lensMapCacheEpoch()).toBe(staleEpoch + 1);
    expect(lookupLensMapImage(options)).toBeNull();
  });

  it('bounds the async image cache by entries and bytes', () => {
    for (let i = 0; i < LENS_MAP_IMAGE_CACHE_LIMIT + 8; i++) {
      const options = { ...BASE, width: BASE.width + i };
      retainLensMapImage(image(options, `data:image/png;base64,${i}`), options);
    }
    const stats = lensMapImageCacheStats();
    expect(stats.size).toBeLessThanOrEqual(LENS_MAP_IMAGE_CACHE_LIMIT);
    expect(stats.bytes).toBeLessThanOrEqual(LENS_MAP_IMAGE_CACHE_BYTES);
    expect(stats.evictions).toBeGreaterThan(0);
  });
});
