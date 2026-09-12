import { createContext, useMemo, type ReactNode } from 'react';
import type { GlassQuality } from './useGlassQuality';
import type { OverLight } from './useOverLight';
import { SvgFilterRegistry } from './SvgFilterRegistry';

export interface GlassConfig {
  quality: GlassQuality;
  overLight: OverLight;
}

export const GlassConfigContext = createContext<GlassConfig>({
  quality: 'medium',
  overLight: 'auto',
});

export interface GlassProviderProps {
  /** Library-wide default quality tier. Default `'medium'`. */
  quality?: GlassQuality;
  /** Library-wide default light/dark adaptation. Default `'auto'`. */
  overLight?: OverLight;
  children?: ReactNode;
}

/**
 * Sets global defaults and mounts the SVG filter registry. Multiple providers
 * are supported (filter ids are namespaced per provider instance).
 */
export function GlassProvider({ quality = 'medium', overLight = 'auto', children }: GlassProviderProps) {
  const config = useMemo<GlassConfig>(() => ({ quality, overLight }), [quality, overLight]);
  return (
    <GlassConfigContext.Provider value={config}>
      <SvgFilterRegistry>{children}</SvgFilterRegistry>
    </GlassConfigContext.Provider>
  );
}
