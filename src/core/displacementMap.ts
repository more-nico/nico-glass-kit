/**
 * Lens displacement map generation.
 *
 * Ported from the nicoGlassKit reference (`packages/core/src/lens/displacement-map.ts`).
 * Four-fold symmetry optimisation + shape-keyed LRU cache: the map only ever
 * depends on shape/size/params, never on the element's position.
 *
 * Encoding (hard constraint):
 *   R = 128 + dx * 127   (x displacement, inward normal at the rim)
 *   G = 128 + dy * 127   (y displacement, inward normal at the rim)
 *   B = 128, A = 255
 */

export const MAX_DISPLACEMENT_PX = 24;
export const LENS_MAP_CACHE_LIMIT = 32;

/**
 * Default raster scale of the PNG handed to `feImage`. The in-memory pixel
 * buffer stays at the full physical resolution (`pixelWidth`/`pixelHeight`);
 * only the exported image is downsampled and the filter stretches it back
 * over the element box (`preserveAspectRatio="none"`). Compositor frame
 * preparation for backdrop `url()` filters scales with the feImage raster
 * size: at 4K on 25 High-tier surfaces, measured frame rate went from 59–66
 * (full resolution) to ~120 fps at this scale. The trade-off is a slightly
 * smoothed normal field; the owner accepted the difference after inspecting
 * side-by-side captures.
 */
export const DEFAULT_LENS_MAP_RASTER_SCALE = 0.2;

/** Lower bound accepted for {@link LensMapOptions.rasterScale}. */
export const MIN_LENS_MAP_RASTER_SCALE = 0.1;

/** Upper bound accepted for {@link LensMapOptions.rasterScale}. */
export const MAX_LENS_MAP_RASTER_SCALE = 0.5;

/** Clamps a caller-provided raster scale into the supported range. */
export function clampLensMapRasterScale(scale: number | undefined): number {
  if (scale === undefined || !Number.isFinite(scale)) return DEFAULT_LENS_MAP_RASTER_SCALE;
  return Math.min(MAX_LENS_MAP_RASTER_SCALE, Math.max(MIN_LENS_MAP_RASTER_SCALE, scale));
}

export interface LensMapOptions {
  /** CSS px. */
  width: number;
  /** CSS px. */
  height: number;
  /** CSS px corner radius (clamped to half the shortest side). */
  radius: number;
  /** Refraction band width in CSS px. */
  edge: number;
  /** 0 = bucket profile (1-t)^2, 1 = squircle profile. */
  curvature: number;
  /** 0–1 normalised displacement amplitude. */
  strength: number;
  /** Rasterisation multiplier; defaults to `dpr` (or 1). */
  quality?: number;
  /** Device pixel ratio; used as the default quality. */
  dpr?: number;
  /**
   * Raster scale of the exported PNG data URL; defaults to
   * {@link DEFAULT_LENS_MAP_RASTER_SCALE} and is clamped into
   * [{@link MIN_LENS_MAP_RASTER_SCALE}, {@link MAX_LENS_MAP_RASTER_SCALE}].
   * The in-memory pixel buffer is unaffected.
   */
  rasterScale?: number;
  /** Skip the PNG data URL (useful in tests / non-DOM environments). */
  skipDataUrl?: boolean;
}

export interface LensMapResult {
  cacheKey: string;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  quality: number;
  /** Raster scale applied to the PNG data URL; `pixels` stays full-size. */
  rasterScale: number;
  /** Value to pass to `feDisplacementMap@scale`. */
  maxScale: number;
  /** RGBA pixels at physical resolution. */
  pixels: Uint8ClampedArray;
  /** PNG data URL, or '' when no canvas is available (SSR/tests). */
  dataUrl: string;
}

interface LensMapCacheStats {
  hits: number;
  misses: number;
  generated: number;
  evictions: number;
  size: number;
}

export type LensMapObserver = (result: LensMapResult) => void;

let observer: LensMapObserver | null = null;

/**
 * Devtools / test instrumentation: observe every cache *miss* (i.e. a real
 * rasterisation). Used by the unit tests to assert that hover/press
 * animations never regenerate the map.
 */
export function setLensMapObserver(next: LensMapObserver | null): void {
  observer = next;
}

const cache = new Map<string, LensMapResult>();
const stats: LensMapCacheStats = { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0 };

export function lensMapCacheStats(): LensMapCacheStats {
  return { ...stats, size: cache.size };
}

export function clearLensMapCache(): void {
  cache.clear();
  stats.size = 0;
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface NormalisedLensShape {
  width: number;
  height: number;
  quality: number;
  pixelWidth: number;
  pixelHeight: number;
  radius: number;
  edge: number;
  curvature: number;
  strength: number;
  rasterScale: number;
}

export function normaliseLensOptions(options: LensMapOptions): NormalisedLensShape {
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const quality = clamp(options.quality ?? options.dpr ?? 1, 0.25, 4);
  const pixelWidth = Math.max(1, Math.round(width * quality));
  const pixelHeight = Math.max(1, Math.round(height * quality));
  const maxRadius = Math.min(pixelWidth, pixelHeight) / 2;
  return {
    width,
    height,
    quality,
    pixelWidth,
    pixelHeight,
    radius: clamp(options.radius * quality, 0, maxRadius),
    edge: Math.max(0.5, options.edge * quality),
    curvature: clamp(options.curvature, 0, 1),
    strength: clamp(options.strength, 0, 1),
    rasterScale: clampLensMapRasterScale(options.rasterScale),
  };
}

export function lensMapCacheKey(options: LensMapOptions): string {
  const shape = normaliseLensOptions(options);
  return [
    `${round(options.width)}x${round(options.height)}`,
    `@${round(shape.quality, 3)}`,
    `r:${round(shape.radius / shape.quality, 3)}`,
    `e:${round(options.edge, 3)}`,
    `p:${round(shape.curvature, 4)}`,
    `s:${round(shape.strength, 4)}`,
    `q:${round(shape.quality, 3)}`,
    `m:${round(shape.rasterScale, 3)}`,
  ].join(':');
}

function encode(value: number): number {
  return clamp(128 + Math.round(value * 127), 1, 255);
}

/**
 * Pure pixel computation. Only the top-left quadrant is evaluated; the other
 * three are written by mirroring, negating the X displacement across the
 * vertical axis and the Y displacement across the horizontal axis.
 */
export function computeLensPixels(options: LensMapOptions): Uint8ClampedArray {
  const shape = normaliseLensOptions(options);
  const { pixelWidth: pw, pixelHeight: ph, radius, edge, curvature } = shape;
  const pixels = new Uint8ClampedArray(pw * ph * 4);
  const cx = pw / 2;
  const cy = ph / 2;
  const hw = pw / 2 - radius;
  const hh = ph / 2 - radius;
  const halfW = Math.ceil(pw / 2);
  const halfH = Math.ceil(ph / 2);

  const setPixel = (x: number, y: number, r: number, g: number): void => {
    const index = (y * pw + x) * 4;
    pixels[index] = r;
    pixels[index + 1] = g;
    pixels[index + 2] = 128;
    pixels[index + 3] = 255;
  };

  for (let y = 0; y < halfH; y++) {
    for (let x = 0; x < halfW; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const qx = Math.abs(px - cx) - hw;
      const qy = Math.abs(py - cy) - hh;
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      const sd = Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;

      // Outward normal of the rounded-rect SDF.
      let ox = 0;
      let oy = 0;
      if (ax > 0 || ay > 0) {
        const length = Math.hypot(ax, ay) || 1;
        ox = (px < cx ? -ax : ax) / length;
        oy = (py < cy ? -ay : ay) / length;
      } else if (qx > qy) {
        ox = px < cx ? -1 : 1;
      } else {
        oy = py < cy ? -1 : 1;
      }

      const t = clamp(-sd / edge, 0, 1);
      const u = 1 - t;
      const bucket = u * u;
      const u4 = u * u * u * u;
      const squircle = 1 - Math.sqrt(Math.sqrt(Math.max(0, 1 - u4)));
      const profile = bucket + (squircle - bucket) * curvature;

      // Inward displacement (samples from inside the shape, matching convex lensing).
      const dx = -ox * profile;
      const dy = -oy * profile;
      const r = encode(dx);
      const g = encode(dy);

      setPixel(x, y, r, g);
      const mx = pw - 1 - x;
      const my = ph - 1 - y;
      if (mx !== x) setPixel(mx, y, 256 - r, g);
      if (my !== y) setPixel(x, my, r, 256 - g);
      if (mx !== x && my !== y) setPixel(mx, my, 256 - r, 256 - g);
    }
  }

  return pixels;
}

/** Physical size of the exported PNG for a full-resolution pixel buffer. */
export function lensMapRasterSize(
  pixelWidth: number,
  pixelHeight: number,
  scale: number = DEFAULT_LENS_MAP_RASTER_SCALE,
): { width: number; height: number } {
  const rasterScale = clampLensMapRasterScale(scale);
  return {
    width: Math.max(1, Math.round(pixelWidth * rasterScale)),
    height: Math.max(1, Math.round(pixelHeight * rasterScale)),
  };
}

/**
 * Rasterise the full-resolution pixel buffer into a PNG data URL, downsampled
 * to `scale` when a DOM canvas is available.
 */
export function renderPixelsToDataUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number = DEFAULT_LENS_MAP_RASTER_SCALE,
): string {
  try {
    if (typeof document !== 'undefined') {
      const source = document.createElement('canvas');
      source.width = width;
      source.height = height;
      const sourceCtx = source.getContext('2d');
      if (!sourceCtx) return '';
      sourceCtx.putImageData(new ImageData(pixels, width, height), 0, 0);

      const raster = lensMapRasterSize(width, height, scale);
      if (raster.width === width && raster.height === height) {
        return source.toDataURL('image/png');
      }

      const target = document.createElement('canvas');
      target.width = raster.width;
      target.height = raster.height;
      const targetCtx = target.getContext('2d');
      if (!targetCtx) return '';
      targetCtx.imageSmoothingEnabled = true;
      targetCtx.imageSmoothingQuality = 'high';
      targetCtx.drawImage(source, 0, 0, raster.width, raster.height);
      return target.toDataURL('image/png');
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Shape-keyed generator with a 32-entry LRU. `maxScale` folds the strength
 * into the `feDisplacementMap@scale` attribute so the 8-bit encoding keeps
 * its full precision.
 */
export function generateLensMap(options: LensMapOptions): LensMapResult {
  const key = lensMapCacheKey(options);
  const cached = cache.get(key);
  if (cached) {
    stats.hits++;
    // Refresh LRU recency.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  stats.misses++;
  const shape = normaliseLensOptions(options);
  const pixels = computeLensPixels(options);
  const dataUrl = options.skipDataUrl
    ? ''
    : renderPixelsToDataUrl(pixels, shape.pixelWidth, shape.pixelHeight, shape.rasterScale);
  const result: LensMapResult = {
    cacheKey: key,
    width: shape.width,
    height: shape.height,
    pixelWidth: shape.pixelWidth,
    pixelHeight: shape.pixelHeight,
    quality: shape.quality,
    rasterScale: shape.rasterScale,
    maxScale: shape.strength * MAX_DISPLACEMENT_PX * (255 / 127),
    pixels,
    dataUrl,
  };
  stats.generated++;
  cache.set(key, result);
  if (cache.size > LENS_MAP_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
      stats.evictions++;
    }
  }
  stats.size = cache.size;
  observer?.(result);
  return result;
}
