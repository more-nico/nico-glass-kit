/**
 * Refraction displacement map generation.
 *
 * Pipeline:
 *   1. Sample the surface profile along the bezel (127 samples) and compute,
 *      per sample, the 2D displacement of a light ray refracted once through
 *      the surface (Snell's law, n1 = 1 air, n2 = 1.5 glass, incident rays
 *      orthogonal to the background).
 *   2. Sweep that 1D profile around the element's rounded-rect edge (the
 *      profile is radially symmetric) to get a per-pixel displacement field.
 *   3. Normalise by the maximum displacement and encode as an RGBA image
 *      (R = X displacement, G = Y displacement, 128 = neutral), used as the
 *      `feDisplacementMap` input. The filter `scale` attribute equals twice
 *      the max displacement so encoded offsets reproduce physical pixels.
 */

import { resolveSurfaceProfile, type SurfaceProfileFn, type SurfaceProfileName } from './surfaceFunctions';

export interface DisplacementMapParams {
  /** Element size in CSS px. */
  width: number;
  height: number;
  /** Corner radius in CSS px. */
  radius: number;
  /** Curved-edge width in px. Default: derived from radius/size. */
  bezel?: number;
  /** Surface profile, default 'squircle'. */
  profile?: SurfaceProfileName | SurfaceProfileFn;
  /** Dome height in px. Default: bezel / 2. */
  maxHeight?: number;
  /** Glass refractive index, default 1.5. */
  refractiveIndex?: number;
  /** Profile sample count along the bezel, default 127. */
  samples?: number;
  /**
   * Overscan: extra neutral pixels around the element box so sub-pixel
   * rounding never exposes unmapped (transparent ⇒ max-offset) fringes.
   */
  pad?: number;
}

export interface DisplacementProfile {
  /** Signed displacement per sample (px, positive = inward along the bezel axis). */
  deltas: Float32Array;
  /** max |deltas|, floored to a tiny epsilon to keep normalisation safe. */
  maxAbs: number;
  bezel: number;
  maxHeight: number;
  samples: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function resolveBezel(params: DisplacementMapParams, w: number, h: number, r: number): number {
  const minDim = Math.min(w, h);
  const fallback = r >= 4 ? Math.min(r, minDim / 2) : Math.min(minDim * 0.2, minDim / 2);
  return Math.max(1, Math.min(params.bezel ?? fallback, minDim / 2));
}

/**
 * Step 1 — 1D displacement profile along the bezel.
 * Normal at each sample: derivative of the surface height rotated −90°,
 * i.e. `normal = normalize(-dh/dt, 1)` (central difference, delta = 0.001).
 */
export function computeDisplacementProfile(
  params: DisplacementMapParams & { bezel: number },
): DisplacementProfile {
  const samples = params.samples ?? 127;
  const bezel = Math.max(1, params.bezel);
  const maxHeight = params.maxHeight ?? bezel / 2;
  const eta = 1 / (params.refractiveIndex ?? 1.5); // n1 (air) / n2 (glass)
  const fn = resolveSurfaceProfile(params.profile);

  const deltas = new Float32Array(samples);
  const EPS = 0.001;
  let maxAbs = 0;

  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * bezel; // px from the outer edge inward
    const x = t / bezel;
    const height = clamp01(fn(clamp01(x))) * maxHeight;

    const dfdx =
      (clamp01(fn(clamp01(x + EPS))) - clamp01(fn(clamp01(x - EPS)))) / (2 * EPS);
    const dhdt = dfdx * (maxHeight / bezel);

    // Surface normal (derivative rotated −90°), pointing up/outward.
    let nx = -dhdt;
    let ny = 1;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;

    // Snell refraction of the incident ray I = (0, -1), single event.
    const cosI = ny; // -(I · n)
    const sinT2 = eta * eta * (1 - cosI * cosI);
    let delta = 0;
    if (sinT2 <= 1) {
      const cosT = Math.sqrt(1 - sinT2);
      const f = eta * cosI - cosT;
      const tx = f * nx;
      const ty = -eta + f * ny;
      if (ty < -1e-6) {
        // Travel from the surface point down to the background plane.
        delta = tx * (height / -ty);
      }
    }
    deltas[i] = delta;
    if (Math.abs(delta) > maxAbs) maxAbs = Math.abs(delta);
  }

  if (maxAbs < 1e-4) maxAbs = 1e-4;
  return { deltas, maxAbs, bezel, maxHeight, samples };
}

export interface DisplacementField {
  /** [dx, dy] per pixel, length width*height*2, in px. */
  field: Float32Array;
  /** Padded bitmap size (element size + 2*pad). */
  width: number;
  height: number;
  maxAbs: number;
  bezel: number;
  /** Overscan applied on each side; feImage must be placed at -pad. */
  pad: number;
}

/**
 * Step 2 — rotate the 1D profile around the element's rounded-rect edge.
 * Distance/direction come from a rounded-rect SDF; pixels farther than the
 * bezel (flat interior) and outside the shape get zero displacement.
 * With `pad > 0` the bitmap is extended by neutral pixels on every side.
 */
export function computeDisplacementField(params: DisplacementMapParams): DisplacementField {
  const w = Math.max(1, Math.round(params.width));
  const h = Math.max(1, Math.round(params.height));
  const pad = Math.max(0, Math.round(params.pad ?? 0));
  const W = w + pad * 2;
  const H = h + pad * 2;
  const r = clamp(Math.min(params.radius, w / 2, h / 2), 0, Math.min(w, h) / 2);
  const bezel = resolveBezel(params, w, h, r);

  const profile = computeDisplacementProfile({ ...params, bezel });
  const { deltas, maxAbs, samples } = profile;

  const sampleDelta = (t: number): number => {
    const u = clamp01(t / bezel) * (samples - 1);
    const i0 = Math.floor(u);
    const i1 = Math.min(samples - 1, i0 + 1);
    const f = u - i0;
    return deltas[i0] * (1 - f) + deltas[i1] * f;
  };

  const field = new Float32Array(W * H * 2);
  const hw = w / 2;
  const hh = h / 2;
  const coreHW = hw - r;
  const coreHH = hh - r;

  for (let y = 0; y < H; y++) {
    const py = y - pad + 0.5 - hh;
    const ay = Math.abs(py);
    for (let x = 0; x < W; x++) {
      const px = x - pad + 0.5 - hw;
      const ax = Math.abs(px);
      const qx = ax - coreHW;
      const qy = ay - coreHH;

      let dist: number;
      let dirX = 0;
      let dirY = 0;
      if (qx > 0 && qy > 0) {
        // Corner region: radial around the arc centre.
        const l = Math.hypot(qx, qy) || 1;
        dist = r - l;
        dirX = (qx / l) * Math.sign(px);
        dirY = (qy / l) * Math.sign(py);
      } else if (qx >= qy) {
        // Left/right straight edge.
        dist = r - qx;
        dirX = Math.sign(px);
      } else {
        // Top/bottom straight edge.
        dist = r - qy;
        dirY = Math.sign(py);
      }

      const idx = (y * W + x) * 2;
      if (dist <= 0 || dist >= bezel) continue; // outside shape or flat interior
      const d = sampleDelta(dist);
      // delta > 0 means "samples the background inward" ⇒ vector = -d * outward.
      field[idx] = -d * dirX;
      field[idx + 1] = -d * dirY;
    }
  }

  return { field, width: W, height: H, maxAbs, bezel, pad };
}

/**
 * Step 3 — encode the field as RGBA: R = X, G = Y, B = 128 neutral, A = 255.
 * Channel value = 128 + (component / maxAbs) * 127.
 */
export function encodeFieldToRGBA(fieldData: DisplacementField): Uint8ClampedArray {
  const { field, width, height, maxAbs } = fieldData;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    const nx = clamp(field[i * 2] / maxAbs, -1, 1);
    const ny = clamp(field[i * 2 + 1] / maxAbs, -1, 1);
    out[i * 4] = 128 + nx * 127;
    out[i * 4 + 1] = 128 + ny * 127;
    out[i * 4 + 2] = 128;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export interface GeneratedDisplacementMap {
  url: string;
  maxAbs: number;
  /** Padded bitmap size. */
  width: number;
  height: number;
  /** feImage placement (negative pad). */
  offsetX: number;
  offsetY: number;
}

const mapCache = new Map<string, GeneratedDisplacementMap>();
const MAP_CACHE_LIMIT = 48;

export function displacementMapCacheKey(
  params: Required<Pick<DisplacementMapParams, 'width' | 'height' | 'radius'>> &
    Pick<DisplacementMapParams, 'bezel' | 'profile'>,
): string {
  const profileName =
    typeof params.profile === 'function' ? 'custom' : (params.profile ?? 'squircle');
  return [
    Math.round(params.width),
    Math.round(params.height),
    Math.round(params.radius),
    Math.round(params.bezel ?? -1),
    profileName,
  ].join('x');
}

/**
 * Client-only: builds (or reuses) the RGBA displacement map as a PNG data URL.
 * Cached per geometry so same-shape elements share a single map.
 */
export function getDisplacementMap(
  params: DisplacementMapParams,
): GeneratedDisplacementMap {
  const key = displacementMapCacheKey({
    width: params.width,
    height: params.height,
    radius: params.radius,
    bezel: params.bezel,
    profile: params.profile,
  });
  const cached = mapCache.get(key);
  if (cached) return cached;

  // 1px neutral overscan on each side (see DisplacementMapParams.pad).
  const fieldData = computeDisplacementField({ ...params, pad: 1 });
  const rgba = encodeFieldToRGBA(fieldData);

  const canvas = document.createElement('canvas');
  canvas.width = fieldData.width;
  canvas.height = fieldData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('nico-glass-kit: 2d canvas context unavailable');
  ctx.putImageData(new ImageData(rgba, fieldData.width, fieldData.height), 0, 0);
  const url = canvas.toDataURL('image/png');

  const generated: GeneratedDisplacementMap = {
    url,
    maxAbs: fieldData.maxAbs,
    width: fieldData.width,
    height: fieldData.height,
    offsetX: -fieldData.pad,
    offsetY: -fieldData.pad,
  };
  if (mapCache.size >= MAP_CACHE_LIMIT) {
    const oldest = mapCache.keys().next().value;
    if (oldest !== undefined) mapCache.delete(oldest);
  }
  mapCache.set(key, generated);
  return generated;
}
