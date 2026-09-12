/**
 * SVG filter assembly for the glass lens.
 *
 * Ported from the nicoGlassKit reference (`packages/core/src/lens/filter.ts`).
 * Blur, saturation and brightness live INSIDE the graph: Chromium silently
 * drops every other function in a backdrop-filter chain that contains url(),
 * so an external blur would never render on the medium/high tiers.
 */

export const LENS_FILTER_COLOR_INTERPOLATION = 'sRGB';

export const DISPERSION_SCALE_EPSILON = 0.2;

export type LensFilterPass =
  | { type: 'blur'; input: string; sigma: number; result: string }
  | { type: 'saturate'; input: string; amount: number; result: string }
  | { type: 'brightness'; input: string; amount: number; result: string }
  | { type: 'displacement'; input: string; map: string; scale: number; result?: string }
  | { type: 'channel'; input: string; channel: 'r' | 'g' | 'b'; result: string }
  | { type: 'blend'; input: string; input2: string; mode: 'screen'; result?: string };

export interface LensFilterOptions {
  mapUrl: string;
  width: number;
  height: number;
  scale: number;
  /** Backdrop blur radius in px, applied inside the graph. */
  blur?: number;
  /** Saturation percentage (100 = unchanged). */
  saturation?: number;
  /** Brightness multiplier (1 = unchanged). */
  brightness?: number;
  /**
   * Always emit the brightness pass (identity at `brightness === 1`) so the
   * registry can retune its slopes in place, e.g. for hover boosts, without
   * rebuilding the filter graph.
   */
  animateBrightness?: boolean;
  /** 0–1 chromatic dispersion amount. */
  dispersion?: number;
  /** Filter region padding in CSS px; derived from blur when omitted. */
  regionPaddingPx?: number;
}

export interface LensFilterDescriptor {
  mapUrl: string;
  width: number;
  height: number;
  scale: number;
  blur: number;
  saturation: number;
  brightness: number;
  dispersion: number;
  /** Region padding in CSS px (blur bleed + dispersion spread). */
  regionPaddingPx: number;
  passes: LensFilterPass[];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function createLensFilter(options: LensFilterOptions): LensFilterDescriptor {
  const dispersion = clamp01(options.dispersion ?? 0);
  const width = Math.max(0, options.width);
  const height = Math.max(0, options.height);
  const scale = options.scale;
  const blur = Math.max(0, options.blur ?? 0);
  const saturation = options.saturation ?? 100;
  const brightness = options.brightness ?? 1;
  const animateBrightness = options.animateBrightness ?? false;

  const passes: LensFilterPass[] = [];
  let stageInput = 'SourceGraphic';

  if (blur > 0) {
    passes.push({ type: 'blur', input: stageInput, sigma: round6(blur / 2), result: 'ngs_blur' });
    stageInput = 'ngs_blur';
  }
  if (saturation !== 100) {
    passes.push({
      type: 'saturate',
      input: stageInput,
      amount: saturation / 100,
      result: 'ngs_sat',
    });
    stageInput = 'ngs_sat';
  }
  if (brightness !== 1 || animateBrightness) {
    passes.push({
      type: 'brightness',
      input: stageInput,
      amount: brightness,
      result: 'ngs_bright',
    });
    stageInput = 'ngs_bright';
  }

  if (dispersion <= 0) {
    passes.push({ type: 'displacement', input: stageInput, map: 'map', scale });
  } else {
    const delta = scale * dispersion * DISPERSION_SCALE_EPSILON;
    passes.push(
      {
        type: 'displacement',
        input: stageInput,
        map: 'map',
        scale: round6(scale + delta),
        result: 'ngs_disp_r',
      },
      {
        type: 'displacement',
        input: stageInput,
        map: 'map',
        scale,
        result: 'ngs_disp_g',
      },
      {
        type: 'displacement',
        input: stageInput,
        map: 'map',
        scale: round6(Math.max(0, scale - delta)),
        result: 'ngs_disp_b',
      },
      { type: 'channel', input: 'ngs_disp_r', channel: 'r', result: 'ngs_ch_r' },
      { type: 'channel', input: 'ngs_disp_g', channel: 'g', result: 'ngs_ch_g' },
      { type: 'channel', input: 'ngs_disp_b', channel: 'b', result: 'ngs_ch_b' },
      { type: 'blend', input: 'ngs_ch_r', input2: 'ngs_ch_g', mode: 'screen', result: 'ngs_ch_rg' },
      { type: 'blend', input: 'ngs_ch_rg', input2: 'ngs_ch_b', mode: 'screen' },
    );
  }

  // The displacement map only ever samples inward (its rim normals point
  // into the shape) and the backdrop-filter output is clipped to the
  // element's rounded border box, so the region beyond the element only
  // needs headroom for the in-graph blur's bleed — not for the displacement
  // scale or the dispersion spread, which are inward-only as well.
  const regionPaddingPx =
    options.regionPaddingPx ??
    Math.ceil(Math.max(blur * 1.5, 4) + 2);

  return {
    mapUrl: options.mapUrl,
    width,
    height,
    scale,
    blur,
    saturation,
    brightness,
    dispersion,
    regionPaddingPx,
    passes,
  };
}

export function lensChannelMatrix(channel: 'r' | 'g' | 'b'): string {
  if (channel === 'r') return '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1';
  if (channel === 'g') return '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 0 1';
  return '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0 1';
}

/** SVG saturation matrix (Rec. 709 luminance weights), `amount` 1 = unchanged. */
export function lensSaturationMatrix(amount: number): string {
  const s = Math.max(0, amount);
  const r = 0.213;
  const g = 0.715;
  const b = 0.072;
  const values = [
    r + (1 - r) * s,
    g - g * s,
    b - b * s,
    0,
    0,
    r - r * s,
    g + (1 - g) * s,
    b - b * s,
    0,
    0,
    r - r * s,
    g - g * s,
    b + (1 - b) * s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
  return values.map((value) => round6(value)).join(' ');
}

/** CSS filter region (percentages of the border box) for a pixel padding. */
export function lensRegionPercent(
  width: number,
  height: number,
  paddingPx: number,
): { x: string; y: string; width: string; height: string } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return {
    x: `${round6((-paddingPx / w) * 100)}%`,
    y: `${round6((-paddingPx / h) * 100)}%`,
    width: `${round6((1 + (paddingPx * 2) / w) * 100)}%`,
    height: `${round6((1 + (paddingPx * 2) / h) * 100)}%`,
  };
}

/**
 * Per-node displacement ratio relative to the filter's base (undispersed)
 * scale. The registry stores these so per-frame elasticity animation can
 * rescale every node multiplicatively (`scale = base * ratio`) without
 * rebuilding anything — R gets `1 + d*eps`, G stays 1, B gets `1 - d*eps`.
 */
export function lensPassScaleRatios(
  passes: LensFilterPass[],
  baseScale: number,
): number[] {
  if (baseScale <= 0) return [];
  return passes.flatMap((pass) => {
    if (pass.type !== 'displacement') return [];
    return [pass.scale / baseScale];
  });
}
