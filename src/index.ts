import './tokens.css';
import './core/glass.css';

export { GlassProvider } from './core/GlassProvider';
export type { GlassConfig, GlassProviderProps } from './core/GlassProvider';

export { GlassSurface } from './core/GlassSurface';
export type { GlassSurfaceProps, GlassGlyphShape } from './core/GlassSurface';

export { GlassLightGroup } from './core/GlassLightGroup';
export type { GlassLightGroupProps } from './core/GlassLightGroup';

export { useGlassQuality } from './core/useGlassQuality';
export type { GlassQuality } from './core/useGlassQuality';
export { useOverLight } from './core/useOverLight';
export type { OverLight } from './core/useOverLight';

export { DEFAULT_OPTICS, resolveOptics, opticsToCssVars } from './core/optics';
export type { GlassOptics } from './core/optics';

export {
  generateLensMap,
  clearLensMapCache,
  lensMapCacheStats,
  DEFAULT_LENS_MAP_RASTER_SCALE,
  MIN_LENS_MAP_RASTER_SCALE,
  MAX_LENS_MAP_RASTER_SCALE,
} from './core/displacementMap';
export type { LensMapOptions, LensMapResult } from './core/displacementMap';

export {
  generateGlyphRaster,
  computeGlyphLensPixels,
  signedDistanceField,
  glyphRingAlpha,
  glyphRasterCacheKey,
  clearGlyphRasterCache,
  glyphRasterCacheStats,
  setGlyphRasterObserver,
  layoutGlyphs,
  measureTextMetrics,
  defaultGlyphRasterScale,
  GLYPH_TILE_PADDING,
  DEFAULT_GLYPH_RING_WIDTH,
  GLYPH_RASTER_CACHE_LIMIT,
} from './core/glyphLensMap';
export type {
  GlyphRaster,
  GlyphRasterOptions,
  GlyphLensOptions,
  GlyphLensResult,
  GlyphMetrics,
  GlyphBox,
  GlyphLayout,
  GlyphLayoutOptions,
  TextMetricsLike,
} from './core/glyphLensMap';

export type { GlassFilterPreset } from './core/SvgFilterRegistry';

export {
  supportsBackdropFilter,
  supportsSvgBackdropFilter,
} from './core/supports';

export { GlassButton } from './components/GlassButton';
export type { GlassButtonProps } from './components/GlassButton';

export { GlassCard } from './components/GlassCard';
export type { GlassCardProps } from './components/GlassCard';

export { GlassNavBar } from './components/GlassNavBar';
export type { GlassNavBarProps } from './components/GlassNavBar';

export { GlassTabBar } from './components/GlassTabBar';
export type { GlassTabBarItem, GlassTabBarProps } from './components/GlassTabBar';

export { GlassPill } from './components/GlassPill';
export type { GlassPillProps } from './components/GlassPill';

export { GlassInput } from './components/GlassInput';
export type { GlassInputProps } from './components/GlassInput';

export { GlassSelect } from './components/GlassSelect';
export type { GlassSelectProps } from './components/GlassSelect';

export { GlassSwitch } from './components/GlassSwitch';
export type { GlassSwitchProps } from './components/GlassSwitch';

export { GlassCheckbox } from './components/GlassCheckbox';
export type { GlassCheckboxProps } from './components/GlassCheckbox';

export { GlassSlider } from './components/GlassSlider';
export type { GlassSliderProps } from './components/GlassSlider';

export { GlassSegmentedControl } from './components/GlassSegmentedControl';
export type {
  GlassSegmentedControlProps,
  GlassSegmentedItem,
} from './components/GlassSegmentedControl';

export { GlassBadge } from './components/GlassBadge';
export type { GlassBadgeProps, GlassBadgeTone } from './components/GlassBadge';

export { GlassAvatar } from './components/GlassAvatar';
export type { GlassAvatarProps } from './components/GlassAvatar';

export { GlassProgress } from './components/GlassProgress';
export type { GlassProgressProps } from './components/GlassProgress';

export { GlassSpinner } from './components/GlassSpinner';
export type { GlassSpinnerProps } from './components/GlassSpinner';

export { GlassAlert } from './components/GlassAlert';
export type { GlassAlertProps, GlassAlertTone } from './components/GlassAlert';

export { GlassModal } from './components/GlassModal';
export type { GlassModalProps } from './components/GlassModal';

export { GlassTooltip } from './components/GlassTooltip';
export type { GlassTooltipProps, GlassTooltipPlacement } from './components/GlassTooltip';

export { GlassText } from './components/GlassText';
export type { GlassTextProps } from './components/GlassText';
