import type { DemoParams } from '../App';

/** Maps playground control-panel params to GlassSurface prop overrides. */
export const glassProps = (p: DemoParams) => ({
  optics: p.optics,
  elasticity: p.elasticity,
  highlightIntensity: p.highlight,
});
