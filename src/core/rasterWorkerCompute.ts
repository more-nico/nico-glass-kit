/**
 * Pure glyph field/lens computation shared by the main thread and the raster
 * worker. No DOM, no caches: the exact same code must run in both places so a
 * worker result and the synchronous fallback are byte-identical.
 *
 * Pipeline (unchanged from the original `glyphLensMap.ts`):
 *   coverage → binary mask → exact Euclidean distance transform
 *   (Felzenszwalb & Huttenlocher) → signed distance field (negative inside)
 *   → outward normal → bevel profile → displacement pixels / ring alpha.
 */

import {
  encodeDisplacement,
  lensDisplacementScale,
  lensEdgePixels,
  lensProfile,
} from './displacementMap';

/** EDT needs many arrays per pixel; reject pathological tiles before allocating. */
export const MAX_GLYPH_RASTER_PIXELS = 4 * 1024 * 1024;

/** Alpha at/above which a coverage pixel counts as inside the glyph. */
export const DEFAULT_GLYPH_THRESHOLD = 128;

/** Pointer-glint band width in CSS px (hard inner outline). */
export const GLYPH_GLINT_WIDTH = 2;

export interface GlyphField {
  /** Signed distance in physical px: negative inside, positive outside. */
  sdf: Float32Array;
  /** Outward normal X (inside pixels only; 0 outside). */
  nx: Float32Array;
  /** Outward normal Y (inside pixels only; 0 outside). */
  ny: Float32Array;
  /** Largest interior distance = half of the thickest stroke, physical px. */
  maxInside: number;
}

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

const EDT_INF = 1e12;

/**
 * Felzenszwalb & Huttenlocher exact squared-distance transform of one line,
 * including the index of the nearest feature pixel (argmin).
 */
function edt1d(f: Float64Array, n: number, dist: Float64Array, arg: Int32Array,
  v: Int32Array, z: Float64Array): void {
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
  const vertices = new Int32Array(line.length);
  const boundaries = new Float64Array(line.length + 1);

  // Pass 1: columns. Every column has at least one feature (the padded ring).
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) line[y] = mask[x * height + y] ? 0 : EDT_INF;
    edt1d(line, height, lineOut, lineArg, vertices, boundaries);
    for (let y = 0; y < height; y++) {
      colDist[x * height + y] = lineOut[y];
      if (withArgmin) colArg[x * height + y] = lineArg[y];
    }
  }

  // Pass 2: rows over the column distances.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = colDist[x * height + y];
    edt1d(line, width, lineOut, lineArg, vertices, boundaries);
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
  const vertices = new Int32Array(width);
  const boundaries = new Float64Array(width + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) line[x] = mask[x * height + y] ? 0 : EDT_INF;
    edt1d(line, width, lineOut, lineArg, vertices, boundaries);
    for (let x = 0; x < width; x++) dist[x * height + y] = lineOut[x];
  }
  return dist;
}

/**
 * Builds the signed distance field of a coverage raster. A one-pixel outside
 * ring is materialised around the raster so the outer distance is exact and
 * `sd = ±(d - 0.5)` matches the pixel-centre convention of the rectangle SDF.
 */
export function computeGlyphField(
  coverage: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = DEFAULT_GLYPH_THRESHOLD,
  wantNormals = false,
): GlyphField {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
    (width + 2) * (height + 2) > MAX_GLYPH_RASTER_PIXELS) {
    throw new RangeError('nico-glass-kit: glyph tile exceeds the safe allocation limit');
  }
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
  const nx = new Float32Array(wantNormals ? width * height : 0);
  const ny = new Float32Array(wantNormals ? width * height : 0);
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

export interface GlyphLensComputeOptions {
  width: number;
  height: number;
  /** Bevel band width in CSS px. */
  edge: number;
  /** 0 = bucket profile, 1 = squircle. */
  curvature: number;
  /** Normalised displacement amplitude, 0–1. */
  strength: number;
  /** Rasterisation multiplier; defaults to 1. */
  quality?: number;
}

/**
 * Displacement pixels from an already computed field. `strength` only folds
 * into `maxScale`; the encoded bytes never depend on it, which is what lets
 * the map cache survive refraction changes.
 */
export function computeGlyphLensPixelsFromField(
  field: GlyphField,
  options: GlyphLensComputeOptions,
): {
  pixels: Uint8ClampedArray;
  maxScale: number;
  edgeUsed: number;
  maxInside: number;
  strengthUsed: number;
} {
  const width = Math.max(1, Math.floor(options.width));
  const height = Math.max(1, Math.floor(options.height));
  const quality = clamp(options.quality ?? 1, 0.25, 4);
  const curvature = clamp(options.curvature, 0, 1);
  const strength = clamp(options.strength, 0, 1);
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

/** White RGB with the coverage/ring alpha, ready for `putImageData`. */
export function alphaToWhiteRgba(alpha: Uint8ClampedArray): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    rgba[i * 4] = 255;
    rgba[i * 4 + 1] = 255;
    rgba[i * 4 + 2] = 255;
    rgba[i * 4 + 3] = alpha[i];
  }
  return rgba;
}
