import { useContext, useEffect, useState } from 'react';
import { GlassConfigContext } from './GlassProvider';
import { supportsBackdropFilter, supportsSvgBackdropFilter } from './supports';

export type GlassQuality = 'low' | 'medium' | 'high';

/**
 * Resolves the requested quality tier through the degradation chain:
 *   high → medium → low (no `backdrop-filter: url()`)
 *   any  → low           (no `backdrop-filter` at all)
 * SSR and first client render always yield `'low'`; the tier upgrades in an
 * effect after mount so server and client markup never mismatch.
 */
export function useGlassQuality(quality?: GlassQuality): GlassQuality {
  const ctx = useContext(GlassConfigContext);
  const requested: GlassQuality = quality ?? ctx.quality ?? 'medium';

  const [effective, setEffective] = useState<GlassQuality>('low');

  useEffect(() => {
    let tier = requested;
    if (!supportsBackdropFilter()) {
      tier = 'low';
    } else if (tier !== 'low' && !supportsSvgBackdropFilter()) {
      tier = 'low';
    }
    setEffective(tier);
  }, [requested]);

  return effective;
}
