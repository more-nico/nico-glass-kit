/**
 * Surface profile functions: cross-section height of the glass edge.
 * Input  `x`: normalised distance from the outer edge (0) to the end of the
 *         bezel (1), where the surface becomes flat.
 * Output: normalised height in [0, 1], multiplied by the dome height later.
 */

export type SurfaceProfileFn = (x: number) => number;

export type SurfaceProfileName = 'squircle' | 'convex' | 'concave' | 'lip';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Apple's favoured squircle (superellipse) profile — smooth, default. */
const squircle: SurfaceProfileFn = (x) => {
  const t = clamp01(x);
  return Math.pow(1 - Math.pow(1 - t, 4), 1 / 4);
};

/** Circular quadrant dome. */
const convex: SurfaceProfileFn = (x) => {
  const t = clamp01(x);
  return Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2)));
};

/** Concave scoop — flat at the very edge, rising steeply at the bezel end. */
const concave: SurfaceProfileFn = (x) => {
  const t = clamp01(x);
  return 1 - Math.sqrt(Math.max(0, 1 - t * t));
};

/** Raised lip at the rim, flat interior. */
const lip: SurfaceProfileFn = (x) => {
  const t = clamp01(x);
  const edge = 0.12;
  if (t >= edge) return 1;
  return Math.sin((t / edge) * (Math.PI / 2));
};

export const surfaceProfiles: Record<SurfaceProfileName, SurfaceProfileFn> = {
  squircle,
  convex,
  concave,
  lip,
};

export function resolveSurfaceProfile(
  profile: SurfaceProfileName | SurfaceProfileFn | undefined,
): SurfaceProfileFn {
  if (typeof profile === 'function') return profile;
  return surfaceProfiles[profile ?? 'squircle'];
}
