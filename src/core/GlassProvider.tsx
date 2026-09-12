import { createContext, useMemo, type ReactNode } from 'react';
import type { GlassQuality } from './useGlassQuality';
import type { OverLight } from './useOverLight';
import { SvgFilterRegistry } from './SvgFilterRegistry';
import { clampLensMapRasterScale, DEFAULT_LENS_MAP_RASTER_SCALE } from './displacementMap';

export interface GlassConfig {
  quality: GlassQuality;
  overLight: OverLight;
  lensMapRasterScale: number;
}

export const GlassConfigContext = createContext<GlassConfig>({
  quality: 'medium',
  overLight: 'auto',
  lensMapRasterScale: DEFAULT_LENS_MAP_RASTER_SCALE,
});

export interface GlassProviderProps {
  /** Library-wide default quality tier. Default `'medium'`. */
  quality?: GlassQuality;
  /**
   * Library-wide default light/dark adaptation. `'auto'` resolves
   * per-element from the backdrop painted beneath each surface.
   * Default `'auto'`.
   */
  overLight?: OverLight;
  /**
   * Raster scale of the displacement-map PNG, default `0.2`, adjustable up to
   * `0.5` and down to `0.1`. The in-memory map keeps its full physical size;
   * lower values shrink only the image handed to the filter, which trades a
   * softer refraction rim for faster compositor preparation on large pages.
   */
  lensMapRasterScale?: number;
  children?: ReactNode;
}

/**
 * Sets global defaults and mounts the SVG filter registry. Multiple providers
 * are supported (filter ids are namespaced per provider instance).
 */
export function GlassProvider({
  quality = 'medium',
  overLight = 'auto',
  lensMapRasterScale = DEFAULT_LENS_MAP_RASTER_SCALE,
  children,
}: GlassProviderProps) {
  const config = useMemo<GlassConfig>(
    () => ({
      quality,
      overLight,
      lensMapRasterScale: clampLensMapRasterScale(lensMapRasterScale),
    }),
    [quality, overLight, lensMapRasterScale],
  );
  return (
    <GlassConfigContext.Provider value={config}>
      <SvgFilterRegistry>{children}</SvgFilterRegistry>
    </GlassConfigContext.Provider>
  );
}
