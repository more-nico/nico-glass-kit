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
 */

import {
  DEFAULT_LENS_MAP_RASTER_SCALE,
  lensDisplacementScale,
  lensEdgePixels,
  clampLensMapRasterScale,
  encodeDisplacement,
  lensProfile,
  renderPixelsToDataUrl,
} from './displacementMap';

/** LRU size of the glyph raster cache (data URLs only, no pixel buffers). */
export const GLYPH_RASTER_CACHE_LIMIT = 128;

/** Ink padding (CSS px) around every glyph tile: room for the ring band. */
export const GLYPH_TILE_PADDING = 3;

/** Static rim fades into the glyph over 3 CSS px; the pointer glint stays 2px. */
export const DEFAULT_GLYPH_RING_WIDTH = 4;
export const GLYPH_GLINT_WIDTH = 2;

/**
 * Curved, closely spaced glyph boundaries need more map pixels than long
 * panel edges: the provider's `lensMapRasterScale` is doubled (clamped into
 * the shared [0.1, 0.5] range).
 */
export const GLYPH_RASTER_SCALE_MULTIPLIER = 2;

/** Alpha at/above which a coverage pixel counts as inside the glyph. */
const DEFAULT_GLYPH_THRESHOLD = 128;

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const EDT_INF = 1e12;

/**
 * Felzenszwalb & Huttenlocher exact squared-distance transform of one line,
 * including the index of the nearest feature pixel (argmin).
 */
function edt1d(f: Float64Array, n: number, dist: Float64Array, arg: Int32Array): void {
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  let k = 0;
  v[0] = 0;
  z[0] = -EDT_INF;
  z[1] = EDT_INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = EDT_INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const delta = q - v[k];
    dist[q] = delta * delta + f[v[k]];
    arg[q] = v[k];
  }
}

interface DistanceField {
  /** Exact squared distance to the nearest feature pixel. */
  dist: Float64Array;
  /** Squared distance to the nearest feature pixel in the same column. */
  colDist: Float64Array;
  /** X index of the nearest feature pixel (argmin tracking only). */
  argX: Int32Array | null;
  /** Y index of the nearest feature pixel, per column (argmin tracking only). */
  argY: Int32Array | null;
}

/** Separable 2D transform over a column-major (`x * height + y`) mask. */
function distanceTransform2d(
  mask: Uint8Array,
  width: number,
  height: number,
  withArgmin: boolean,
): DistanceField {
  const n = width * height;
  const colDist = new Float64Array(n);
  const colArg = new Int32Array(withArgmin ? n : 0);
  const dist = new Float64Array(n);
  const argX = withArgmin ? new Int32Array(n) : null;
  const line = new Float64Array(Math.max(width, height));
  const lineOut = new Float64Array(Math.max(width, height));
  const lineArg = new Int32Array(Math.max(width, height));

  // Pass 1: columns. Every column has at least one feature (the padded ring).
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) line[y] = mask[x * height + y] ? 0 : EDT_INF;
    edt1d(line, height, lineOut, lineArg);
    for (let y = 0; y < height; y++) {
      colDist[x * height + y] = lineOut[y];
      if (withArgmin) colArg[x * height + y] = lineArg[y];
    }
  }

  // Pass 2: rows over the column distances.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = colDist[x * height + y];
    edt1d(line, width, lineOut, lineArg);
    for (let x = 0; x < width; x++) {
      dist[x * height + y] = lineOut[x];
      if (argX) argX[x * height + y] = lineArg[x];
    }
  }

  return { dist, colDist, argX, argY: withArgmin ? colArg : null };
}

/** Squared distance to the nearest feature pixel in the same row. */
function rowDistance(mask: Uint8Array, width: number, height: number): Float64Array {
  const dist = new Float64Array(width * height);
  const line = new Float64Array(width);
  const lineOut = new Float64Array(width);
  const lineArg = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = mask[x * height + y] ? 0 : EDT_INF;
    edt1d(line, width, lineOut, lineArg);
    for (let x = 0; x < width; x++) dist[x * height + y] = lineOut[x];
  }
  return dist;
}

interface GlyphField {
  /** Signed distance in physical px: negative inside, positive outside. */
  sdf: Float32Array;
  /** Outward normal X (inside pixels only; 0 outside). */
  nx: Float32Array;
  /** Outward normal Y (inside pixels only; 0 outside). */
  ny: Float32Array;
  /** Largest interior distance = half of the thickest stroke, physical px. */
  maxInside: number;
}

/**
 * Builds the signed distance field of a coverage raster. A one-pixel outside
 * ring is materialised around the raster so the outer distance is exact and
 * `sd = ±(d - 0.5)` matches the pixel-centre convention of the rectangle SDF.
 */
function computeGlyphField(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  wantNormals: boolean,
): GlyphField {
  const pw = width + 2;
  const ph = height + 2;
  const n = pw * ph;

  const inside = new Uint8Array(n);
  const outside = new Uint8Array(n);
  outside.fill(1);
  // Both masks use the column-major layout of `distanceTransform2d`.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (coverage[y * width + x] >= threshold) {
        const p = (x + 1) * ph + (y + 1);
        inside[p] = 1;
        outside[p] = 0;
      }
    }
  }

  const out = distanceTransform2d(outside, pw, ph, wantNormals);
  const ins = distanceTransform2d(inside, pw, ph, false);
  const rows = wantNormals ? rowDistance(outside, pw, ph) : null;

  const sdf = new Float32Array(width * height);
  const nx = new Float32Array(width * height);
  const ny = new Float32Array(width * height);
  let maxInside = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (x + 1) * ph + (y + 1);
      const j = y * width + x;
      if (inside[p]) {
        const d = Math.sqrt(out.dist[p]) - 0.5;
        sdf[j] = -d;
        if (d > maxInside) maxInside = d;
        if (wantNormals && out.argX && out.argY && rows) {
          const featureX = out.argX[p];
          let dx = featureX - (x + 1);
          let dy = out.argY[featureX * ph + (y + 1)] - (y + 1);
          // Exact axis ties: the rectangle path prefers the Y axis (`qx > qy`).
          if (rows[p] === out.colDist[p]) {
            dx = 0;
            dy = out.argY[p] - (y + 1);
          }
          const length = Math.hypot(dx, dy) || 1;
          nx[j] = dx / length;
          ny[j] = dy / length;
        }
      } else {
        sdf[j] = Math.sqrt(ins.dist[p]) - 0.5;
      }
    }
  }

  return { sdf, nx, ny, maxInside };
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
  const { sdf, nx, ny, maxInside } = field;

  const edgeUsed = lensEdgePixels(options.edge, quality);
  const strengthUsed = strength;

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let j = 0; j < width * height; j++) {
    let r = 128;
    let g = 128;
    const sd = sdf[j];
    if (sd < 0) {
      const t = clamp(-sd / edgeUsed, 0, 1);
      const profile = lensProfile(t, curvature);
      // Inward displacement, matching convex lensing.
      r = encodeDisplacement(-nx[j] * profile);
      g = encodeDisplacement(-ny[j] * profile);
    }
    const k = j * 4;
    pixels[k] = r;
    pixels[k + 1] = g;
    pixels[k + 2] = 128;
    pixels[k + 3] = 255;
  }

  return {
    pixels,
    maxScale: lensDisplacementScale(strengthUsed),
    edgeUsed,
    maxInside,
    strengthUsed,
    sdf,
  };
}

/**
 * Inner outline band. Feathered bands fade smoothly from the contour to zero
 * at ringWidthPx inside the glyph; hard bands retain a pixel-wide transition.
 * Coverage clips the outer edge, including the edges of character holes.
 */
export function glyphRingAlpha(
  sdf: Float32Array,
  width: number,
  height: number,
  ringWidthPx: number,
  feather = false,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(width * height);
  const ring = Math.max(0, ringWidthPx);
  if (ring === 0) return alpha;
  for (let i = 0; i < alpha.length; i++) {
    if (sdf[i] >= 0) continue;
    const t = clamp(1 + sdf[i] / ring, 0, 1);
    alpha[i] = Math.round((feather
      ? t * t * (3 - 2 * t)
      : clamp(ring + sdf[i] + 0.5, 0, 1)) * 255);
  }
  return alpha;
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
    ctx = document.createElement('canvas').getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;

  try {
    ctx.font = font;
    if (tabularNums) ctx.fontKerning = 'none';
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
}

export type GlyphRasterObserver = (raster: GlyphRaster) => void;

let observer: GlyphRasterObserver | null = null;

/** Devtools / test instrumentation: observe every real rasterisation. */
export function setGlyphRasterObserver(next: GlyphRasterObserver | null): void {
  observer = next;
}

const cache = new Map<string, GlyphRaster>();
const stats: GlyphRasterCacheStats = { hits: 0, misses: 0, generated: 0, evictions: 0, size: 0 };

export function glyphRasterCacheStats(): GlyphRasterCacheStats {
  return { ...stats, size: cache.size };
}

export function clearGlyphRasterCache(): void {
  cache.clear();
  stats.size = 0;
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

/** White RGB with the given alpha, as a PNG data URL. */
function renderAlphaToDataUrl(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  try {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
  const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const image = ctx.createImageData(width, height);
    const data = image.data;
    for (let i = 0; i < alpha.length; i++) {
      data[i * 4] = 255;
      data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255;
      data[i * 4 + 3] = alpha[i];
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

function rasteriseGlyph(options: GlyphRasterOptions): Omit<GlyphRaster, 'key'> | null {
  if (typeof document === 'undefined') return null;
  const quality = clamp(options.dpr ?? 1, 0.25, 4);
  const pixelWidth = Math.max(1, Math.round(options.width * quality));
  const pixelHeight = Math.max(1, Math.round(options.height * quality));

  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
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

  const lens = computeGlyphLensPixels(coverage, {
    width: pixelWidth,
    height: pixelHeight,
    edge: options.depth,
    curvature: options.curvature,
    strength: options.refraction,
    quality,
  });
  const ring = glyphRingAlpha(
    lens.sdf,
    pixelWidth,
    pixelHeight,
    Math.max(0, options.ringWidth ?? DEFAULT_GLYPH_RING_WIDTH) * quality,
    true,
  );
  const glint = glyphRingAlpha(lens.sdf, pixelWidth, pixelHeight, GLYPH_GLINT_WIDTH * quality);
  const rasterScale = clampLensMapRasterScale(
    options.rasterScale ?? defaultGlyphRasterScale(undefined),
  );

  return {
    maskUrl: options.skipDataUrl ? '' : renderAlphaToDataUrl(coverage, pixelWidth, pixelHeight),
    ringUrl: options.skipDataUrl ? '' : renderAlphaToDataUrl(ring, pixelWidth, pixelHeight),
    glintUrl: options.skipDataUrl ? '' : renderAlphaToDataUrl(glint, pixelWidth, pixelHeight),
    mapUrl: options.skipDataUrl
      ? ''
      : renderPixelsToDataUrl(lens.pixels, pixelWidth, pixelHeight, rasterScale),
    scale: lens.maxScale,
    width: options.width,
    height: options.height,
    pixelWidth,
    pixelHeight,
    edgeUsed: lens.edgeUsed,
    maxInside: lens.maxInside,
  };
}

/**
 * Rasterise one character into a glyph tile: coverage mask, outline ring mask
 * and displacement map, all as data URLs. Shape-keyed LRU (128 entries);
 * only the data URLs are retained, never the pixel buffers.
 */
export function generateGlyphRaster(options: GlyphRasterOptions): GlyphRaster | null {
  const key = glyphRasterCacheKey(options);
  const cached = cache.get(key);
  if (cached) {
    stats.hits++;
    // Refresh LRU recency.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  if (typeof document === 'undefined') return null;

  stats.misses++;
  let raster: Omit<GlyphRaster, 'key'> | null;
  try {
    raster = rasteriseGlyph(options);
  } catch {
    return null;
  }
  if (!raster) return null;
  // Failed PNG generation must not be cached or hide the readable fallback.
  if (!options.skipDataUrl && (!raster.maskUrl || !raster.ringUrl || !raster.glintUrl || !raster.mapUrl)) return null;

  const result: GlyphRaster = { key, ...raster };
  stats.generated++;
  cache.set(key, result);
  if (cache.size > GLYPH_RASTER_CACHE_LIMIT) {
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
