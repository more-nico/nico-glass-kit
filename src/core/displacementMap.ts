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
/** Shared CSS-to-raster bevel width and CSS displacement amplitude. */
export const lensEdgePixels = (edge: number, quality: number): number =>
  Math.max(0.5, Math.max(0.5, edge) * quality);
export const lensDisplacementScale = (strength: number): number =>
  Math.min(1, Math.max(0, strength)) * MAX_DISPLACEMENT_PX * (255 / 127);
export const LENS_MAP_CACHE_LIMIT = 32;
/** Cap retained full-resolution buffers as well as entry count. */
export const LENS_MAP_CACHE_BYTES = 32 * 1024 * 1024;
/** Fail before a pathological geometry can allocate more than 256 MiB of RGBA. */
export const MAX_LENS_MAP_PIXELS = 64 * 1024 * 1024;

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
  /** Bytes retained by full pixel buffers and PNG strings (UTF-16 upper bound). */
  bytes: number;
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

const cache = new Map<string, LensMapResult | LensMapImage>();
const stats: LensMapCacheStats = { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 };

/** The renderer only needs the PNG and scale, never a retained RGBA buffer. */
export type LensMapImage = Omit<LensMapResult, 'pixels'>;
const retainedBytes = (result: LensMapResult | LensMapImage): number =>
  ('pixels' in result ? result.pixels.byteLength : 0) + result.dataUrl.length * 2;

export function lensMapCacheStats(): LensMapCacheStats {
  return { ...stats, size: cache.size };
}

export function clearLensMapCache(): void {
  cache.clear();
  stats.size = 0;
  stats.bytes = 0;
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
  if (![options.width, options.height, options.radius, options.edge, options.curvature,
    options.strength, options.quality ?? options.dpr ?? 1].every(Number.isFinite)) {
    throw new RangeError('nico-glass-kit: lens geometry must be finite');
  }
  const width = Math.max(1, options.width);
  const height = Math.max(1, options.height);
  const quality = clamp(options.quality ?? options.dpr ?? 1, 0.25, 4);
  const pixelWidth = Math.max(1, Math.round(width * quality));
  const pixelHeight = Math.max(1, Math.round(height * quality));
  if (pixelWidth * pixelHeight > MAX_LENS_MAP_PIXELS) {
    throw new RangeError('nico-glass-kit: lens map exceeds the safe allocation limit');
  }
  const maxRadius = Math.min(pixelWidth, pixelHeight) / 2;
  return {
    width,
    height,
    quality,
    pixelWidth,
    pixelHeight,
    radius: clamp(options.radius * quality, 0, maxRadius),
    edge: lensEdgePixels(options.edge, quality),
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

/**
 * 8-bit displacement encoding, shared with the glyph lens path
 * (`glyphLensMap.ts`) so both shapes refract through the same formula.
 */
export function encodeDisplacement(value: number): number {
  return clamp(128 + Math.round(value * 127), 1, 255);
}

/**
 * Bevel profile, 0 at the interior end of the band and 1 at the rim.
 * `t = clamp(-sd / edge, 0, 1)`: `bucket` is the (1-t)² falloff, `squircle`
 * the fuller squircle falloff; `curvature` blends between them. Shared with
 * the glyph lens path.
 */
export function lensProfile(t: number, curvature: number): number {
  const u = 1 - t;
  const bucket = u * u;
  if (curvature === 0) return bucket;
  const u4 = u * u * u * u;
  const squircle = 1 - Math.sqrt(Math.sqrt(Math.max(0, 1 - u4)));
  return bucket + (squircle - bucket) * curvature;
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

  // Fill the exactly neutral field in native code. Evaluate the SDF only
  // near the bevel/corner: large panes have millions of flat interior pixels.
  // Build the word from bytes so the fast fill is endian-independent.
  const neutral = new Uint8Array([128, 128, 128, 255]);
  new Uint32Array(pixels.buffer).fill(new Uint32Array(neutral.buffer)[0]);

  for (let y = 0; y < halfH; y++) {
    const limit = y + 0.5 >= edge
      ? Math.min(halfW, Math.ceil(Math.max(radius, edge)))
      : halfW;
    for (let x = 0; x < limit; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const qx = Math.abs(px - cx) - hw;
      const qy = Math.abs(py - cy) - hh;
      const ax = Math.max(qx, 0);
      const ay = Math.max(qy, 0);
      const length = Math.hypot(ax, ay);
      const sd = length + Math.min(Math.max(qx, qy), 0) - radius;

      if (sd <= -edge) continue;

      // Outward normal of the rounded-rect SDF.
      let ox = 0;
      let oy = 0;
      if (ax > 0 || ay > 0) {
        ox = (px < cx ? -ax : ax) / length;
        oy = (py < cy ? -ay : ay) / length;
      } else if (qx > qy) {
        ox = px < cx ? -1 : 1;
      } else {
        oy = py < cy ? -1 : 1;
      }

      const t = clamp(-sd / edge, 0, 1);
      const profile = lensProfile(t, curvature);

      // Inward displacement (samples from inside the shape, matching convex lensing).
      const dx = -ox * profile;
      const dy = -oy * profile;
      const r = encodeDisplacement(dx);
      const g = encodeDisplacement(dy);

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
      // This is a CPU bitmap -> downsample -> PNG pipeline, with a synchronous
      // readback every time. Keeping both canvases on the CPU avoids flushing
      // the compositor/GPU queue during resize. The full field and 'high'
      // smoothing are unchanged; Skia backend rounding can differ at the rim.
      const sourceCtx = source.getContext('2d', { willReadFrequently: true });
      if (!sourceCtx) return '';
      sourceCtx.putImageData(new ImageData(pixels, width, height), 0, 0);

      const raster = lensMapRasterSize(width, height, scale);
      if (raster.width === width && raster.height === height) {
        return source.toDataURL('image/png');
      }

      const target = document.createElement('canvas');
      target.width = raster.width;
      target.height = raster.height;
      const targetCtx = target.getContext('2d', { willReadFrequently: true });
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
  return generateMap(options, true) as LensMapResult;
}

/** Internal render path: same pixels/PNG, with only the encoded image cached. */
export function generateLensMapImage(options: LensMapOptions): LensMapImage {
  const shape = normaliseLensOptions(options);
  // Strength changes only the SVG scale, so reuse the very same image.
  const image = generateMap({ ...options, strength: 1 }, false);
  return { ...image, maxScale: lensDisplacementScale(shape.strength) };
}

function generateMap(options: LensMapOptions, keepPixels: boolean): LensMapResult | LensMapImage {
  // A test/SSR request must not poison a later request for a real PNG.
  const key = `${lensMapCacheKey(options)}:${keepPixels ? 'pixels' : 'image'}:${options.skipDataUrl ? 'raw' : 'png'}`;
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
  const result: LensMapResult | LensMapImage = {
    cacheKey: lensMapCacheKey(options),
    width: shape.width,
    height: shape.height,
    pixelWidth: shape.pixelWidth,
    pixelHeight: shape.pixelHeight,
    quality: shape.quality,
    rasterScale: shape.rasterScale,
    maxScale: lensDisplacementScale(shape.strength),
    ...(keepPixels ? { pixels } : null),
    dataUrl,
  };
  stats.generated++;
  if (observer) observer({ ...result, pixels });
  // Failed DOM encodes are retryable (e.g. a transient allocation failure).
  if (!options.skipDataUrl && !dataUrl) return result;
  cache.set(key, result);
  stats.bytes += retainedBytes(result);
  while (cache.size > LENS_MAP_CACHE_LIMIT || stats.bytes > LENS_MAP_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      stats.bytes -= retainedBytes(cache.get(oldest)!);
      cache.delete(oldest);
      stats.evictions++;
    }
  }
  stats.size = cache.size;
  return result;
}
