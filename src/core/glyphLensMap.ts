/**
 * Glyph lens maps: the same refraction pipeline as `displacementMap.ts`
 * (identical encode/profile/`maxScale` formulas) applied to a character's
 * coverage raster instead of a rounded rectangle.
 *
 *   coverage → binary mask → exact Euclidean distance transform (Felzenszwalb
 *   & Huttenlocher) → signed distance field (negative inside) → outward normal
 *   (direction to the nearest outside pixel) → bevel profile → displacement map.
 *
 * Geometry supplies only distance and normal. Bevel width and displacement
 * amplitude use the rectangle path's rules, including on thin strokes.
 *
 * Encoding (hard constraint, shared with the rectangle path):
 *   R = 128 + dx * 127, G = 128 + dy * 127, B = 128, A = 255
 *
 * Caches are split so a material change does not repeat unrelated work:
 *   coverage (font raster) → field/SDF → map pixels and ring alpha → encoded
 *   PNGs. Only the map pixels depend on depth/curvature; refraction folds into
 *   `feDisplacementMap@scale` and never invalidates an encoded map. Every
 *   layer is an entry- and byte-bounded LRU (see `*_CACHE_*` constants).
 */

import {
  DEFAULT_LENS_MAP_RASTER_SCALE,
  lensDisplacementScale,
  lensEdgePixels,
  clampLensMapRasterScale,
  lensMapRasterSize,
} from './displacementMap';
import {
  DEFAULT_GLYPH_THRESHOLD,
  GLYPH_GLINT_WIDTH,
  MAX_GLYPH_RASTER_PIXELS,
  alphaToWhiteRgba,
  computeGlyphField,
  computeGlyphLensPixelsFromField,
  glyphRingAlpha,
  type GlyphField,
} from './rasterWorkerCompute';

/** LRU size of the glyph raster cache (data URLs only, no pixel buffers). */
export const GLYPH_RASTER_CACHE_LIMIT = 128;
/** Retained encoded glyphs, in addition to the entry-count limit. */
export const GLYPH_RASTER_CACHE_BYTES = 32 * 1024 * 1024;
export { GLYPH_GLINT_WIDTH, MAX_GLYPH_RASTER_PIXELS, glyphRingAlpha };
export type { GlyphField };

/** Coverage arrays: one byte per physical pixel. */
export const GLYPH_COVERAGE_CACHE_LIMIT = 96;
export const GLYPH_COVERAGE_CACHE_BYTES = 16 * 1024 * 1024;
/** SDF + normals: 12 bytes per physical pixel. */
export const GLYPH_FIELD_CACHE_LIMIT = 64;
export const GLYPH_FIELD_CACHE_BYTES = 40 * 1024 * 1024;
/** RGBA displacement pixels: 4 bytes per physical pixel. */
export const GLYPH_MAP_CACHE_LIMIT = 48;
export const GLYPH_MAP_CACHE_BYTES = 32 * 1024 * 1024;
/** Ring/glint alpha: one byte per physical pixel. */
export const GLYPH_RING_CACHE_LIMIT = 96;
export const GLYPH_RING_CACHE_BYTES = 8 * 1024 * 1024;
/** PNG data URL strings (UTF-16 upper bound). */
export const GLYPH_ENCODED_CACHE_LIMIT = 192;
export const GLYPH_ENCODED_CACHE_BYTES = 24 * 1024 * 1024;

/** Ink padding (CSS px) around every glyph tile: room for the ring band. */
export const GLYPH_TILE_PADDING = 3;

/** Static rim fades into the glyph over 3 CSS px; the pointer glint stays 2px. */
export const DEFAULT_GLYPH_RING_WIDTH = 4;

/**
 * Curved, closely spaced glyph boundaries need more map pixels than long
 * panel edges: the provider's `lensMapRasterScale` is doubled (clamped into
 * the shared [0.1, 0.5] range).
 */
export const GLYPH_RASTER_SCALE_MULTIPLIER = 2;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Signed distance field of a coverage raster (physical px, negative inside).
 * Pure: no DOM, safe to unit test in node.
 */
export function signedDistanceField(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  return computeGlyphField(alpha, width, height, DEFAULT_GLYPH_THRESHOLD, false).sdf;
}

export interface GlyphLensOptions {
  /** Coverage raster width, physical px. */
  width: number;
  /** Coverage raster height, physical px. */
  height: number;
  /** Bevel band width in CSS px (optics.depth). */
  edge: number;
  /** 0 = bucket profile, 1 = squircle (optics.curvature). */
  curvature: number;
  /** Normalised displacement amplitude (optics.refraction), 0–1. */
  strength: number;
  /** Rasterisation multiplier; defaults to `dpr` (or 1), clamped to [0.25, 4]. */
  quality?: number;
  /** Device pixel ratio; used as the default quality. */
  dpr?: number;
  /** Coverage alpha that counts as inside. Default 128. */
  threshold?: number;
}

export interface GlyphLensResult {
  /** RGBA displacement pixels at physical resolution. */
  pixels: Uint8ClampedArray;
  /** Value to pass to `feDisplacementMap@scale`. */
  maxScale: number;
  /** Bevel band actually used, physical px. */
  edgeUsed: number;
  /** Thickest half-stroke, physical px. */
  maxInside: number;
  /** Normalised material strength, independent of stroke width. */
  strengthUsed: number;
  /** The signed distance field the map was built from (physical px). */
  sdf: Float32Array;
}

/**
 * Displacement map of a coverage raster. Outside pixels stay neutral (128) —
 * they are masked away, and the rim is where the refraction lives.
 *
 * Kept cache-free and pure so frozen pixel hashes stay reproducible; the
 * renderer goes through the split caches in `generateGlyphRaster`.
 */
export function computeGlyphLensPixels(
  coverage: Uint8ClampedArray,
  options: GlyphLensOptions,
): GlyphLensResult {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const quality = clamp(options.quality ?? options.dpr ?? 1, 0.25, 4);
  const curvature = clamp(options.curvature, 0, 1);
  const strength = clamp(options.strength, 0, 1);

  const field = computeGlyphField(
    coverage,
    width,
    height,
    options.threshold ?? DEFAULT_GLYPH_THRESHOLD,
    true,
  );
  const lens = computeGlyphLensPixelsFromField(field, {
    width,
    height,
    edge: options.edge,
    curvature,
    strength,
    quality,
  });

  return { ...lens, sdf: field.sdf };
}

/** Per-character metrics, ink relative to the pen origin / baseline, CSS px. */
export interface GlyphMetrics {
  /** Horizontal advance. */
  advance: number;
  /** Left edge of the ink box (usually ≤ 0). */
  inkLeft: number;
  /** Right edge of the ink box. */
  inkRight: number;
  /** Top edge of the ink box (negative above the baseline). */
  inkTop: number;
  /** Bottom edge of the ink box (positive below the baseline). */
  inkBottom: number;
}

/** One non-blank character's tile box, container coordinates in CSS px. */
export interface GlyphBox {
  /** Index of the character in the source string. */
  index: number;
  char: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pen origin inside the tile (canvas placement), CSS px. */
  penX: number;
  /** Baseline inside the tile (canvas placement), CSS px. */
  baseline: number;
}

export interface GlyphLayout {
  /** Advance width of the whole string, CSS px. */
  width: number;
  /** Line box height (ascent + descent), CSS px. */
  height: number;
  /** Baseline offset from the container top, CSS px. */
  baseline: number;
  /** Tiles for every character that has ink; blank glyphs are skipped. */
  glyphs: GlyphBox[];
}

export interface GlyphLayoutOptions {
  /** Widest advance measured across all ten digits, not just this string. */
  digitAdvance?: number;
  /** Baseline ascent, CSS px; defaults to the tallest ink box. */
  ascent?: number;
  /** Baseline descent, CSS px; defaults to the deepest ink box. */
  descent?: number;
  /** Ink padding around each tile, CSS px. Default {@link GLYPH_TILE_PADDING}. */
  padding?: number;
}

const ZERO_METRICS: GlyphMetrics = {
  advance: 0,
  inkLeft: 0,
  inkRight: 0,
  inkTop: 0,
  inkBottom: 0,
};

const isDigit = (char: string): boolean => char >= '0' && char <= '9';

/**
 * Pure layout: advances every character (kerning comes from the measured
 * advances), positions its tile at the ink box plus padding, and returns the
 * container box. `tabularNums` widens digits to `max(0-9 advance)` so clocks
 * do not jump between frames.
 */
export function layoutGlyphs(
  text: string,
  metrics: GlyphMetrics[],
  letterSpacing: number,
  tabularNums: boolean,
  options: GlyphLayoutOptions = {},
): GlyphLayout {
  const padding = Math.max(0, options.padding ?? GLYPH_TILE_PADDING);
  const spacing = Number.isFinite(letterSpacing) ? letterSpacing : 0;
  const count = text.length;

  let digitAdvance = options.digitAdvance ?? 0;
  if (tabularNums) {
    for (let i = 0; i < count; i++) {
      if (isDigit(text[i])) {
        digitAdvance = Math.max(digitAdvance, metrics[i]?.advance ?? 0);
      }
    }
  }

  let ascent = options.ascent;
  let descent = options.descent;
  if (ascent === undefined || descent === undefined) {
    let inkAscent = 0;
    let inkDescent = 0;
    for (let i = 0; i < count; i++) {
      const m = metrics[i];
      if (!m) continue;
      inkAscent = Math.max(inkAscent, -m.inkTop);
      inkDescent = Math.max(inkDescent, m.inkBottom);
    }
    if (ascent === undefined) ascent = inkAscent;
    if (descent === undefined) descent = inkDescent;
  }

  const glyphs: GlyphBox[] = [];
  let pen = 0;
  for (let i = 0; i < count; i++) {
    const char = text[i];
    const m = metrics[i] ?? ZERO_METRICS;
    const advance = tabularNums && isDigit(char) ? digitAdvance : m.advance;
    const inkWidth = m.inkRight - m.inkLeft;
    const inkHeight = m.inkBottom - m.inkTop;
    if (inkWidth > 0 && inkHeight > 0) {
      glyphs.push({
        index: i,
        char,
        x: pen + m.inkLeft - padding,
        y: ascent + m.inkTop - padding,
        width: inkWidth + padding * 2,
        height: inkHeight + padding * 2,
        penX: padding - m.inkLeft,
        baseline: padding - m.inkTop,
      });
    }
    pen += advance + spacing;
  }

  return {
    width: count > 0 ? Math.max(0, pen - spacing) : 0,
    height: ascent + descent,
    baseline: ascent,
    glyphs,
  };
}

export interface TextMetricsLike {
  digitAdvance: number;
  /** Total advance width, CSS px. */
  width: number;
  /** Per-character metrics, in string order. */
  glyphs: GlyphMetrics[];
  /** Ascent above the baseline, CSS px. */
  ascent: number;
  /** Descent below the baseline, CSS px. */
  descent: number;
}

/**
 * Canvas measurement of a single-line string. Canvas is the single source of
 * truth for the glass glyphs: advances come from prefix widths (kerning
 * preserved) and ink boxes from `actualBoundingBox*`. Returns null without a
 * DOM canvas (SSR / node).
 */
export function measureTextMetrics(text: string, font: string, tabularNums = false): TextMetricsLike | null {
  if (typeof document === 'undefined') return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    // Measuring never draws: one reused canvas avoids a per-frame allocation
    // during font-size drags. Resetting `fontKerning` keeps tabular and normal
    // measurements independent of call order.
    if (!measureCanvas) measureCanvas = document.createElement('canvas');
    ctx = measureCanvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  try {
    ctx.font = font;
    ctx.fontKerning = tabularNums ? 'none' : 'auto';
    const digitAdvance = Math.max(...Array.from('0123456789', (digit) => ctx!.measureText(digit).width));
    const glyphs: GlyphMetrics[] = [];
    let previous = 0;
    for (let i = 0; i < text.length; i++) {
      const prefix = ctx.measureText(text.slice(0, i + 1)).width;
      const advance = prefix - previous;
      previous = prefix;
      const m = ctx.measureText(text[i]);
      const kern = advance - m.width;
      // `-0` would leak into layout arithmetic; normalise it away.
      const inkLeft = -m.actualBoundingBoxLeft + kern;
      const inkTop = -m.actualBoundingBoxAscent;
      glyphs.push({
        advance,
        inkLeft: inkLeft === 0 ? 0 : inkLeft,
        inkRight: m.actualBoundingBoxRight + kern,
        inkTop: inkTop === 0 ? 0 : inkTop,
        inkBottom: m.actualBoundingBoxDescent,
      });
    }
    const total = ctx.measureText(text);
    const ascent = total.fontBoundingBoxAscent ?? total.actualBoundingBoxAscent ?? 0;
    const descent = total.fontBoundingBoxDescent ?? total.actualBoundingBoxDescent ?? 0;
    return { width: total.width, glyphs, ascent, descent, digitAdvance };
  } catch {
    return null;
  }
}

/** Map-PNG raster scale used for glyph tiles (provider scale × 2, clamped). */
export function defaultGlyphRasterScale(lensMapRasterScale?: number): number {
  const base = lensMapRasterScale ?? DEFAULT_LENS_MAP_RASTER_SCALE;
  return clampLensMapRasterScale(base * GLYPH_RASTER_SCALE_MULTIPLIER);
}

export interface GlyphRasterOptions {
  /** Single displayable character (0x21–0x7E). */
  char: string;
  /** CSS font shorthand accepted by `ctx.font`. */
  font: string;
  /** Tile box width in CSS px (ink box + padding). */
  width: number;
  /** Tile box height in CSS px (ink box + padding). */
  height: number;
  /** Pen origin inside the tile, CSS px. */
  penX: number;
  /** Baseline inside the tile, CSS px. */
  baseline: number;
  /** Bevel band width (optics.depth), CSS px. */
  depth: number;
  /** 0 = bucket profile, 1 = squircle (optics.curvature). */
  curvature: number;
  /** Displacement amplitude (optics.refraction), 0–1. */
  refraction: number;
  /** Device pixel ratio; clamped into [0.25, 4]. Default 1. */
  dpr?: number;
  /** Map PNG raster scale; defaults to {@link defaultGlyphRasterScale}. */
  rasterScale?: number;
  /** Ring band width in CSS px. Default {@link DEFAULT_GLYPH_RING_WIDTH}. */
  ringWidth?: number;
  /** Skip the PNG data URLs (tests / non-DOM). */
  skipDataUrl?: boolean;
}

export interface GlyphRaster {
  /** Cache key (char + font + geometry + optics). */
  key: string;
  /** Coverage mask PNG (glyph fill). */
  maskUrl: string;
  /** Outline ring PNG (highlight mask). */
  ringUrl: string;
  /** Two-pixel inner band for the pointer glint. */
  glintUrl: string;
  /** Displacement map PNG. */
  mapUrl: string;
  /** Value for `feDisplacementMap@scale`. */
  scale: number;
  /** Tile box, CSS px. */
  width: number;
  height: number;
  /** Raster size, physical px. */
  pixelWidth: number;
  pixelHeight: number;
  /** Bevel band used, physical px. */
  edgeUsed: number;
  /** Thickest half-stroke, physical px. */
  maxInside: number;
}

interface GlyphRasterCacheStats {
  hits: number;
  misses: number;
  generated: number;
  evictions: number;
  size: number;
  bytes: number;
}

export type GlyphRasterObserver = (raster: GlyphRaster) => void;

let observer: GlyphRasterObserver | null = null;

/** Devtools / test instrumentation: observe every real rasterisation. */
export function setGlyphRasterObserver(next: GlyphRasterObserver | null): void {
  observer = next;
}

interface LayerCacheStats {
  hits: number;
  misses: number;
  generated: number;
  evictions: number;
  size: number;
  bytes: number;
}

export interface GlyphLayerCacheStats {
  coverage: LayerCacheStats;
  field: LayerCacheStats;
  map: LayerCacheStats;
  ring: LayerCacheStats;
  encoded: LayerCacheStats;
}

interface Metered {
  bytes: number;
}

interface CacheMeter {
  stats: LayerCacheStats;
  limit: number;
  byteLimit: number;
}

interface CoverageEntry extends Metered {
  coverage: Uint8ClampedArray;
}

interface FieldEntry extends Metered {
  field: GlyphField;
}

interface MapEntry extends Metered {
  pixels: Uint8ClampedArray;
}

interface RingEntry extends Metered {
  alpha: Uint8ClampedArray;
}

interface EncodedEntry extends Metered {
  url: string;
  /** Carried so a preview can report the same metadata as a full raster. */
  maxInside?: number;
}

const cache = new Map<string, GlyphRaster>();
/**
 * Bumped by `clearGlyphRasterCache` (font reloads, explicit teardown). It is
 * folded into every layer key so an in-flight worker reply from before the
 * clear can never be retained as current, and old worker entries become
 * unreachable instead of colliding with the reloaded font.
 */
let cacheEpoch = 0;
const stats: GlyphRasterCacheStats = { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 };
const rasterBytes = (raster: GlyphRaster): number =>
  (raster.maskUrl.length + raster.ringUrl.length + raster.glintUrl.length + raster.mapUrl.length) * 2;

const coverageCache = new Map<string, CoverageEntry>();
const fieldCache = new Map<string, FieldEntry>();
const mapCache = new Map<string, MapEntry>();
const ringCache = new Map<string, RingEntry>();
const encodedCache = new Map<string, EncodedEntry>();

const coverageMeter: CacheMeter = {
  stats: { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 },
  limit: GLYPH_COVERAGE_CACHE_LIMIT,
  byteLimit: GLYPH_COVERAGE_CACHE_BYTES,
};
const fieldMeter: CacheMeter = {
  stats: { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 },
  limit: GLYPH_FIELD_CACHE_LIMIT,
  byteLimit: GLYPH_FIELD_CACHE_BYTES,
};
const mapMeter: CacheMeter = {
  stats: { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 },
  limit: GLYPH_MAP_CACHE_LIMIT,
  byteLimit: GLYPH_MAP_CACHE_BYTES,
};
const ringMeter: CacheMeter = {
  stats: { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 },
  limit: GLYPH_RING_CACHE_LIMIT,
  byteLimit: GLYPH_RING_CACHE_BYTES,
};
const encodedMeter: CacheMeter = {
  stats: { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0, bytes: 0 },
  limit: GLYPH_ENCODED_CACHE_LIMIT,
  byteLimit: GLYPH_ENCODED_CACHE_BYTES,
};

function layerSnapshot(meter: CacheMeter): LayerCacheStats {
  return { ...meter.stats, size: meter.stats.size };
}

export function glyphLayerCacheStats(): GlyphLayerCacheStats {
  return {
    coverage: layerSnapshot(coverageMeter),
    field: layerSnapshot(fieldMeter),
    map: layerSnapshot(mapMeter),
    ring: layerSnapshot(ringMeter),
    encoded: layerSnapshot(encodedMeter),
  };
}

export function glyphRasterCacheStats(): GlyphRasterCacheStats {
  return { ...stats, size: cache.size };
}

function clearLayer<T extends Metered>(
  map: Map<string, T>,
  meter: CacheMeter,
): void {
  map.clear();
  meter.stats.size = 0;
  meter.stats.bytes = 0;
}

export function glyphRasterCacheEpoch(): number {
  return cacheEpoch;
}

export function clearGlyphRasterCache(): void {
  cacheEpoch++;
  cache.clear();
  stats.size = 0;
  stats.bytes = 0;
  clearLayer(coverageCache, coverageMeter);
  clearLayer(fieldCache, fieldMeter);
  clearLayer(mapCache, mapMeter);
  clearLayer(ringCache, ringMeter);
  clearLayer(encodedCache, encodedMeter);
  // Drop the reusable CPU canvases too: a font reload must not retain the old
  // raster's backing store.
  measureCanvas = null;
  textCanvas = null;
  alphaCanvas = null;
  alphaCanvasWidth = 0;
  alphaCanvasHeight = 0;
  mapSourceCanvas = null;
  mapSourceWidth = 0;
  mapSourceHeight = 0;
  mapTargetCanvas = null;
  mapTargetWidth = 0;
  mapTargetHeight = 0;
}

function layerGet<T extends Metered>(
  map: Map<string, T>,
  key: string,
  meter: CacheMeter,
): T | undefined {
  const value = map.get(key);
  if (value) {
    meter.stats.hits++;
    // Refresh LRU recency.
    map.delete(key);
    map.set(key, value);
    return value;
  }
  meter.stats.misses++;
  return undefined;
}

function layerPut<T extends Metered>(
  map: Map<string, T>,
  key: string,
  value: T,
  meter: CacheMeter,
): void {
  const previous = map.get(key);
  if (previous) {
    meter.stats.bytes -= previous.bytes;
    map.delete(key);
  }
  map.set(key, value);
  meter.stats.bytes += value.bytes;
  meter.stats.generated++;
  while (map.size > meter.limit || meter.stats.bytes > meter.byteLimit) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    const evicted = map.get(oldest)!;
    meter.stats.bytes -= evicted.bytes;
    map.delete(oldest);
    meter.stats.evictions++;
  }
  meter.stats.size = map.size;
}

/** Stable cache key: everything the raster depends on. */
export function glyphRasterCacheKey(options: GlyphRasterOptions): string {
  const quality = clamp(options.dpr ?? 1, 0.25, 4);
  const rasterScale = clampLensMapRasterScale(
    options.rasterScale ?? defaultGlyphRasterScale(undefined),
  );
  return [
    options.char,
    options.font,
    `${round(options.width)}x${round(options.height)}`,
    `p:${round(options.penX, 3)},${round(options.baseline, 3)}`,
    `@${round(quality, 3)}`,
    `e:${round(options.depth, 3)}`,
    `c:${round(options.curvature, 4)}`,
    `s:${round(options.refraction, 4)}`,
    `m:${round(rasterScale, 3)}`,
    `r:${round(options.ringWidth ?? DEFAULT_GLYPH_RING_WIDTH, 3)}`,
  ].join('|');
}

export interface GlyphRasterPartKeys {
  /** Font raster (independent of every optic). */
  coverageKey: string;
  /** SDF + normals. */
  fieldKey: string;
  /** Displacement pixels (depth/curvature, not refraction). */
  mapKey: string;
  /** Feathered outline alpha. */
  ringKey: string;
  /** Hard pointer glint alpha. */
  glintKey: string;
  /** Coverage PNG. */
  maskKey: string;
  /** Displacement PNG (includes the export raster scale). */
  mapUrlKey: string;
}

export interface NormalisedGlyphRaster {
  /** Cache epoch captured when the keys were derived (font reloads bump it). */
  epoch: number;
  quality: number;
  rasterScale: number;
  pixelWidth: number;
  pixelHeight: number;
  keys: GlyphRasterPartKeys;
}

/**
 * Derives every split-cache key for a glyph. Coverage/SDF/ring ignore
 * depth/curvature/refraction; the map key ignores refraction, so dragging the
 * refraction slider reuses the same encoded map and only changes `scale`.
 */
export function normaliseGlyphRaster(options: GlyphRasterOptions): NormalisedGlyphRaster {
  const quality = clamp(options.dpr ?? 1, 0.25, 4);
  const rasterScale = clampLensMapRasterScale(
    options.rasterScale ?? defaultGlyphRasterScale(undefined),
  );
  const pixelWidth = Math.max(1, Math.round(options.width * quality));
  const pixelHeight = Math.max(1, Math.round(options.height * quality));
  const coverageKey = [
    options.char,
    options.font,
    `${pixelWidth}x${pixelHeight}`,
    `p:${round(options.penX, 3)},${round(options.baseline, 3)}`,
    `@${round(quality, 3)}`,
    `v:${cacheEpoch}`,
  ].join('|');
  const fieldKey = `${coverageKey}|t:${DEFAULT_GLYPH_THRESHOLD}`;
  const edgeUsed = lensEdgePixels(options.depth, quality);
  const mapKey = `${fieldKey}|e:${round(edgeUsed, 4)}|c:${round(clamp(options.curvature, 0, 1), 4)}`;
  const ringWidthPx = Math.max(0, options.ringWidth ?? DEFAULT_GLYPH_RING_WIDTH) * quality;
  const glintWidthPx = GLYPH_GLINT_WIDTH * quality;
  const ringKey = `${fieldKey}|r:${round(ringWidthPx, 3)}|f:1`;
  const glintKey = `${fieldKey}|r:${round(glintWidthPx, 3)}|f:0`;
  return {
    epoch: cacheEpoch,
    quality,
    rasterScale,
    pixelWidth,
    pixelHeight,
    keys: {
      coverageKey,
      fieldKey,
      mapKey,
      ringKey,
      glintKey,
      maskKey: `${coverageKey}|mask`,
      mapUrlKey: `${mapKey}|@${round(rasterScale, 3)}`,
    },
  };
}

/**
 * CPU canvas used to rasterise glyph coverage. `willReadFrequently` keeps the
 * bitmap on the CPU: `getImageData` would otherwise flush the compositor on
 * every font-size frame.
 */
let measureCanvas: HTMLCanvasElement | null = null;
let textCanvas: HTMLCanvasElement | null = null;
let alphaCanvas: HTMLCanvasElement | null = null;
let alphaCanvasWidth = 0;
let alphaCanvasHeight = 0;
let mapSourceCanvas: HTMLCanvasElement | null = null;
let mapSourceWidth = 0;
let mapSourceHeight = 0;
let mapTargetCanvas: HTMLCanvasElement | null = null;
let mapTargetWidth = 0;
let mapTargetHeight = 0;

function acquireTextCanvas(width: number, height: number): HTMLCanvasElement | null {
  try {
    if (!textCanvas) textCanvas = document.createElement('canvas');
    // Assigning the size always resets the bitmap and the 2D state, which is
    // exactly the clean canvas `fillText` needs.
    textCanvas.width = width;
    textCanvas.height = height;
    return textCanvas;
  } catch {
    return null;
  }
}

function rasteriseCoverage(options: GlyphRasterOptions, normalised: NormalisedGlyphRaster): Uint8ClampedArray | null {
  const { pixelWidth, pixelHeight, quality } = normalised;
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) ||
    (pixelWidth + 2) * (pixelHeight + 2) > MAX_GLYPH_RASTER_PIXELS) return null;
  if (typeof document === 'undefined') return null;

  const canvas = acquireTextCanvas(pixelWidth, pixelHeight);
  if (!canvas) return null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    return null;
  }
  if (!ctx) return null;

  ctx.scale(quality, quality);
  ctx.font = options.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.fillText(options.char, options.penX, options.baseline);

  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, pixelWidth, pixelHeight);
  } catch {
    return null;
  }
  const coverage = new Uint8ClampedArray(pixelWidth * pixelHeight);
  for (let i = 0; i < coverage.length; i++) coverage[i] = image.data[i * 4 + 3];
  return coverage;
}

/**
 * Main-thread coverage rasterisation (font drawing must stay here: a worker
 * would resolve a different font set). Cached separately from every optic.
 */
export function prepareGlyphCoverage(
  options: GlyphRasterOptions,
): { coverage: Uint8ClampedArray; normalised: NormalisedGlyphRaster } | null {
  const normalised = normaliseGlyphRaster(options);
  const cached = layerGet(coverageCache, normalised.keys.coverageKey, coverageMeter);
  if (cached) return { coverage: cached.coverage, normalised };

  const coverage = rasteriseCoverage(options, normalised);
  if (!coverage) return null;
  layerPut(coverageCache, normalised.keys.coverageKey, {
    coverage,
    bytes: coverage.byteLength,
  }, coverageMeter);
  return { coverage, normalised };
}

function getField(
  normalised: NormalisedGlyphRaster,
  coverage: Uint8ClampedArray,
): GlyphField | null {
  const cached = layerGet(fieldCache, normalised.keys.fieldKey, fieldMeter);
  if (cached) return cached.field;

  let field: GlyphField;
  try {
    field = computeGlyphField(
      coverage,
      normalised.pixelWidth,
      normalised.pixelHeight,
      DEFAULT_GLYPH_THRESHOLD,
      true,
    );
  } catch {
    return null;
  }
  layerPut(fieldCache, normalised.keys.fieldKey, {
    field,
    bytes: field.sdf.byteLength + field.nx.byteLength + field.ny.byteLength,
  }, fieldMeter);
  return field;
}

interface MapPixels {
  pixels: Uint8ClampedArray;
  edgeUsed: number;
  maxInside: number;
}

function getMapPixels(
  options: GlyphRasterOptions,
  normalised: NormalisedGlyphRaster,
  field: GlyphField,
): MapPixels | null {
  const cached = layerGet(mapCache, normalised.keys.mapKey, mapMeter);
  if (cached) {
    return {
      pixels: cached.pixels,
      edgeUsed: lensEdgePixels(options.depth, normalised.quality),
      maxInside: field.maxInside,
    };
  }

  const lens = computeGlyphLensPixelsFromField(field, {
    width: normalised.pixelWidth,
    height: normalised.pixelHeight,
    edge: options.depth,
    curvature: options.curvature,
    strength: options.refraction,
    quality: normalised.quality,
  });
  layerPut(mapCache, normalised.keys.mapKey, {
    pixels: lens.pixels,
    bytes: lens.pixels.byteLength,
  }, mapMeter);
  return { pixels: lens.pixels, edgeUsed: lens.edgeUsed, maxInside: lens.maxInside };
}

function getRingAlpha(
  normalised: NormalisedGlyphRaster,
  field: GlyphField,
  key: string,
  widthPx: number,
  feather: boolean,
): Uint8ClampedArray {
  const cached = layerGet(ringCache, key, ringMeter);
  if (cached) return cached.alpha;
  const alpha = glyphRingAlpha(
    field.sdf,
    normalised.pixelWidth,
    normalised.pixelHeight,
    widthPx,
    feather,
  );
  layerPut(ringCache, key, { alpha, bytes: alpha.byteLength }, ringMeter);
  return alpha;
}

/** White RGB with the given alpha, reused CPU canvas. */
function encodeAlphaToDataUrl(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  try {
    if (typeof document === 'undefined') return '';
    if (!alphaCanvas) alphaCanvas = document.createElement('canvas');
    if (alphaCanvasWidth !== width || alphaCanvasHeight !== height) {
      alphaCanvas.width = width;
      alphaCanvas.height = height;
      alphaCanvasWidth = width;
      alphaCanvasHeight = height;
    }
    const ctx = alphaCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '';
    const image = ctx.createImageData(width, height);
    image.data.set(alphaToWhiteRgba(alpha));
    ctx.putImageData(image, 0, 0);
    return alphaCanvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

/**
 * RGBA displacement → downsampled PNG on reused CPU canvases. The source is
 * fully opaque, so `putImageData`/`drawImage` overwrite every destination
 * pixel and no per-frame clear is needed.
 */
function encodePixelsToDataUrl(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): string {
  try {
    if (typeof document === 'undefined') return '';
    if (!mapSourceCanvas) mapSourceCanvas = document.createElement('canvas');
    if (mapSourceWidth !== width || mapSourceHeight !== height) {
      mapSourceCanvas.width = width;
      mapSourceCanvas.height = height;
      mapSourceWidth = width;
      mapSourceHeight = height;
    }
    const sourceCtx = mapSourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) return '';
    sourceCtx.putImageData(new ImageData(pixels, width, height), 0, 0);

    const raster = lensMapRasterSize(width, height, scale);
    if (raster.width === width && raster.height === height) {
      return mapSourceCanvas.toDataURL('image/png');
    }

    if (!mapTargetCanvas) mapTargetCanvas = document.createElement('canvas');
    if (mapTargetWidth !== raster.width || mapTargetHeight !== raster.height) {
      mapTargetCanvas.width = raster.width;
      mapTargetCanvas.height = raster.height;
      mapTargetWidth = raster.width;
      mapTargetHeight = raster.height;
    }
    const targetCtx = mapTargetCanvas.getContext('2d', { willReadFrequently: true });
    if (!targetCtx) return '';
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.imageSmoothingQuality = 'high';
    targetCtx.drawImage(mapSourceCanvas, 0, 0, raster.width, raster.height);
    return mapTargetCanvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

function getEncoded(
  key: string,
  encode: () => string,
  maxInside?: number,
): string {
  const cached = layerGet(encodedCache, key, encodedMeter);
  if (cached) return cached.url;
  const url = encode();
  // A failed PNG encode is retryable and must not hide the readable fallback.
  if (!url) return '';
  layerPut(encodedCache, key, {
    url,
    bytes: url.length * 2,
    ...(maxInside === undefined ? null : { maxInside }),
  }, encodedMeter);
  return url;
}

interface EncodedRasterParts {
  maskUrl: string;
  ringUrl: string;
  glintUrl: string;
  mapUrl: string;
}

function peekEncoded(key: string): EncodedEntry | undefined {
  const entry = encodedCache.get(key);
  if (!entry) return undefined;
  // Preview lookups should not let a hot layer fall out just because only
  // the full raster cache counted as a hit.
  encodedCache.delete(key);
  encodedCache.set(key, entry);
  return entry;
}

function lookupEncodedParts(
  normalised: NormalisedGlyphRaster,
): EncodedRasterParts | null {
  const mask = peekEncoded(normalised.keys.maskKey);
  const ring = peekEncoded(normalised.keys.ringKey);
  const glint = peekEncoded(normalised.keys.glintKey);
  const map = peekEncoded(normalised.keys.mapUrlKey);
  if (!mask || !ring || !glint || !map) return null;
  return { maskUrl: mask.url, ringUrl: ring.url, glintUrl: glint.url, mapUrl: map.url };
}

function rasteriseWithCoverage(
  options: GlyphRasterOptions,
  coverage: Uint8ClampedArray,
  normalised: NormalisedGlyphRaster,
): Omit<GlyphRaster, 'key'> | null {
  const field = getField(normalised, coverage);
  if (!field) return null;
  const map = getMapPixels(options, normalised, field);
  if (!map) return null;

  const ringWidthPx = Math.max(0, options.ringWidth ?? DEFAULT_GLYPH_RING_WIDTH) * normalised.quality;
  const glintWidthPx = GLYPH_GLINT_WIDTH * normalised.quality;
  const ring = getRingAlpha(normalised, field, normalised.keys.ringKey, ringWidthPx, true);
  const glint = getRingAlpha(normalised, field, normalised.keys.glintKey, glintWidthPx, false);

  let maskUrl = '';
  let ringUrl = '';
  let glintUrl = '';
  let mapUrl = '';
  if (!options.skipDataUrl) {
    maskUrl = getEncoded(
      normalised.keys.maskKey,
      () => encodeAlphaToDataUrl(coverage, normalised.pixelWidth, normalised.pixelHeight),
    );
    ringUrl = getEncoded(
      normalised.keys.ringKey,
      () => encodeAlphaToDataUrl(ring, normalised.pixelWidth, normalised.pixelHeight),
    );
    glintUrl = getEncoded(
      normalised.keys.glintKey,
      () => encodeAlphaToDataUrl(glint, normalised.pixelWidth, normalised.pixelHeight),
    );
    mapUrl = getEncoded(
      normalised.keys.mapUrlKey,
      () => encodePixelsToDataUrl(
        map.pixels,
        normalised.pixelWidth,
        normalised.pixelHeight,
        normalised.rasterScale,
      ),
      map.maxInside,
    );
    if (!maskUrl || !ringUrl || !glintUrl || !mapUrl) return null;
  }

  return {
    maskUrl,
    ringUrl,
    glintUrl,
    mapUrl,
    scale: lensDisplacementScale(clamp(options.refraction, 0, 1)),
    width: options.width,
    height: options.height,
    pixelWidth: normalised.pixelWidth,
    pixelHeight: normalised.pixelHeight,
    edgeUsed: map.edgeUsed,
    maxInside: map.maxInside,
  };
}

function storeRaster(
  result: GlyphRaster,
  options: GlyphRasterOptions,
  epoch: number = cacheEpoch,
): GlyphRaster {
  // A task prepared before a font/cache clear must not repopulate the new
  // epoch with stale pixels, even if it finishes afterwards.
  if (epoch !== cacheEpoch) return result;
  const storageKey = `${result.key}:${options.skipDataUrl ? 'raw' : 'png'}`;
  const existing = cache.get(storageKey);
  if (existing) {
    stats.hits++;
    cache.delete(storageKey);
    cache.set(storageKey, existing);
    return existing;
  }
  stats.generated++;
  cache.set(storageKey, result);
  stats.bytes += rasterBytes(result);
  while (cache.size > GLYPH_RASTER_CACHE_LIMIT || stats.bytes > GLYPH_RASTER_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    stats.bytes -= rasterBytes(cache.get(oldest)!);
    cache.delete(oldest);
    stats.evictions++;
  }
  stats.size = cache.size;
  observer?.(result);
  return result;
}

/**
 * Rasterise one character into a glyph tile: coverage mask, outline ring mask
 * and displacement map, all as data URLs. Shape-keyed LRU (128 entries);
 * only the data URLs are retained, never the pixel buffers.
 */
export function generateGlyphRaster(options: GlyphRasterOptions): GlyphRaster | null {
  const key = glyphRasterCacheKey(options);
  const storageKey = `${key}:${options.skipDataUrl ? 'raw' : 'png'}`;
  const cached = cache.get(storageKey);
  if (cached) {
    stats.hits++;
    // Refresh LRU recency.
    cache.delete(storageKey);
    cache.set(storageKey, cached);
    return cached;
  }
  if (typeof document === 'undefined') return null;

  stats.misses++;
  const prepared = prepareGlyphCoverage(options);
  if (!prepared) return null;

  let raster: Omit<GlyphRaster, 'key'> | null;
  try {
    raster = rasteriseWithCoverage(options, prepared.coverage, prepared.normalised);
  } catch {
    return null;
  }
  if (!raster) return null;
  return storeRaster({ key, ...raster }, options, prepared.normalised.epoch);
}

/**
 * Same raster path with a coverage buffer that was already rasterised (the
 * worker fallback / a caller that kept the canvas readback).
 */
export function generateGlyphRasterFromCoverage(
  options: GlyphRasterOptions,
  coverage: Uint8ClampedArray,
): GlyphRaster | null {
  const key = glyphRasterCacheKey(options);
  const storageKey = `${key}:${options.skipDataUrl ? 'raw' : 'png'}`;
  const cached = cache.get(storageKey);
  if (cached) {
    stats.hits++;
    cache.delete(storageKey);
    cache.set(storageKey, cached);
    return cached;
  }
  if (typeof document === 'undefined') return null;

  stats.misses++;
  const normalised = normaliseGlyphRaster(options);
  let raster: Omit<GlyphRaster, 'key'> | null;
  try {
    raster = rasteriseWithCoverage(options, coverage, normalised);
  } catch {
    return null;
  }
  if (!raster) return null;
  return storeRaster({ key, ...raster }, options, normalised.epoch);
}

/**
 * Worker-fallback entry: the keys/epoch were captured when the job was
 * submitted, so a font reload in between cannot remap this glyph to the new
 * font's layer cache.
 */
export function generateGlyphRasterFromPrepared(
  options: GlyphRasterOptions,
  coverage: Uint8ClampedArray,
  normalised: NormalisedGlyphRaster,
): GlyphRaster | null {
  const key = glyphRasterCacheKey(options);
  const storageKey = `${key}:${options.skipDataUrl ? 'raw' : 'png'}`;
  const cached = cache.get(storageKey);
  if (cached) {
    stats.hits++;
    cache.delete(storageKey);
    cache.set(storageKey, cached);
    return cached;
  }
  if (typeof document === 'undefined') return null;

  stats.misses++;
  let raster: Omit<GlyphRaster, 'key'> | null;
  try {
    raster = rasteriseWithCoverage(options, coverage, normalised);
  } catch {
    return null;
  }
  if (!raster) return null;
  return storeRaster({ key, ...raster }, options, normalised.epoch);
}

/**
 * Cache-only lookup for the high-frequency path. If every encoded layer is
 * already present (typical while dragging refraction), the raster is
 * assembled without touching EDT, font rasterisation or the canvas encoder.
 * Returns null without side effects when a layer is missing.
 */
export function previewGlyphRaster(options: GlyphRasterOptions): GlyphRaster | null {
  const key = glyphRasterCacheKey(options);
  const storageKey = `${key}:${options.skipDataUrl ? 'raw' : 'png'}`;
  const cached = cache.get(storageKey);
  if (cached) {
    stats.hits++;
    cache.delete(storageKey);
    cache.set(storageKey, cached);
    return cached;
  }
  if (options.skipDataUrl || typeof document === 'undefined') return null;

  const normalised = normaliseGlyphRaster(options);
  const parts = lookupEncodedParts(normalised);
  if (!parts) return null;
  const mapEntry = peekEncoded(normalised.keys.mapUrlKey);
  const result: GlyphRaster = {
    key,
    ...parts,
    scale: lensDisplacementScale(clamp(options.refraction, 0, 1)),
    width: options.width,
    height: options.height,
    pixelWidth: normalised.pixelWidth,
    pixelHeight: normalised.pixelHeight,
    edgeUsed: lensEdgePixels(options.depth, normalised.quality),
    maxInside: mapEntry?.maxInside ?? 0,
  };
  // Assembled from already-generated layers: count it as a hit, not a new
  // rasterisation, and keep it for the next exact lookup.
  stats.hits++;
  cache.set(storageKey, result);
  stats.bytes += rasterBytes(result);
  while (cache.size > GLYPH_RASTER_CACHE_LIMIT || stats.bytes > GLYPH_RASTER_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    stats.bytes -= rasterBytes(cache.get(oldest)!);
    cache.delete(oldest);
    stats.evictions++;
  }
  stats.size = cache.size;
  return result;
}

/**
 * Adopts a raster produced by the worker (or any external encoder): stores it
 * in the exact-result LRU and registers its PNGs in the split caches so later
 * refraction changes can preview without a round trip.
 */
export function retainGlyphRaster(
  result: GlyphRaster,
  options: GlyphRasterOptions,
  epoch?: number,
): GlyphRaster {
  // A worker reply that was in flight across a font reload belongs to the
  // previous epoch: hand it back to the caller but never cache it.
  if (epoch !== undefined && epoch !== cacheEpoch) return result;
  const normalised = normaliseGlyphRaster(options);
  const putEncoded = (key: string, url: string, maxInside?: number): void => {
    if (!url || encodedCache.has(key)) return;
    layerPut(encodedCache, key, {
      url,
      bytes: url.length * 2,
      ...(maxInside === undefined ? null : { maxInside }),
    }, encodedMeter);
  };
  putEncoded(normalised.keys.maskKey, result.maskUrl);
  putEncoded(normalised.keys.ringKey, result.ringUrl);
  putEncoded(normalised.keys.glintKey, result.glintUrl);
  putEncoded(normalised.keys.mapUrlKey, result.mapUrl, result.maxInside);
  return storeRaster(result, options);
}
