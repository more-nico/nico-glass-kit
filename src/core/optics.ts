/**
 * Optics parameter surface for nico-glass-kit.
 *
 * Ported from the nicoGlassKit reference (`packages/core/src/optics.ts`):
 * every value is a real, adjustable perceptual parameter. The defaults are the
 * tuned house material — a nearly clear pane (low blur, no saturation shift)
 * with a strong, full-depth bevel and a trace of chromatic dispersion.
 */

export interface GlassOptics {
  /** Backdrop blur radius in px. */
  blur: number;
  /** Saturation percentage, 100 = unchanged. */
  saturation: number;
  /** Brightness multiplier, 0–2. */
  brightness: number;
  /** Base tint colour consumed by color-mix. */
  tint: string;
  /** Tint strength 0–1. */
  tintStrength: number;
  /** Refraction strength 0–1 (mapped to the displacement scale). */
  refraction: number;
  /** Refraction band width in px. */
  depth: number;
  /** Bevel profile, 0 = bucket (1-t)^2, 1 = squircle. */
  curvature: number;
  /** Chromatic dispersion 0–1 (high tier only). */
  dispersion: number;
}

export const DEFAULT_OPTICS: GlassOptics = {
  // A clear pane: almost no blur, so the refraction band is what reads as glass.
  blur: 4,
  saturation: 100,
  brightness: 1.8,
  tint: 'light-dark(rgb(255 255 255), rgb(18 20 26))',
  tintStrength: 0.2,
  refraction: 1,
  depth: 10,
  curvature: 0.49,
  // A trace of dispersion: enough to fringe the rim without becoming a rainbow.
  dispersion: 0.1,
};

export type OpticsInput = Partial<GlassOptics> | null | undefined;

/** Merge an ordered list of layers (defaults first, last layer wins). */
export function resolveOptics(...layers: OpticsInput[]): GlassOptics {
  const result: GlassOptics = { ...DEFAULT_OPTICS };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) continue;
      (result as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

const CSS_VAR_BY_KEY: Record<keyof GlassOptics, string> = {
  blur: '--ngs-glass-blur',
  saturation: '--ngs-glass-saturation',
  brightness: '--ngs-glass-brightness',
  tint: '--ngs-glass-tint',
  tintStrength: '--ngs-glass-tint-strength',
  refraction: '--ngs-lens-refraction',
  depth: '--ngs-lens-depth',
  curvature: '--ngs-lens-curvature',
  dispersion: '--ngs-lens-dispersion',
};

function formatValue(key: keyof GlassOptics, value: GlassOptics[keyof GlassOptics]): string {
  if (key === 'blur' || key === 'depth') return `${Number(value)}px`;
  if (key === 'saturation') return `${Number(value)}%`;
  if (typeof value === 'number') return String(value);
  return String(value);
}

/** Map any subset of optics to the public CSS variable surface. */
export function opticsToCssVars(optics: Partial<GlassOptics>): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(optics)) {
    if (value === undefined) continue;
    const cssVar = CSS_VAR_BY_KEY[key as keyof GlassOptics];
    if (!cssVar) continue;
    vars[cssVar] = formatValue(key as keyof GlassOptics, value as GlassOptics[keyof GlassOptics]);
  }
  return vars;
}
