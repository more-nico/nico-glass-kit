import type { DemoParams } from '../App';

/** Maps playground control-panel params to GlassSurface prop overrides. */
export const glassProps = (p: DemoParams) => ({
  displacementScale: p.displacementScale,
  blur: p.blur,
  saturation: p.saturation,
  aberrationIntensity: p.aberration,
  elasticity: p.elasticity,
  highlightIntensity: p.highlight,
});
