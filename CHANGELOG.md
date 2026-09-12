# Changelog

## 0.2.0

Glass engine ported from the reference nicoGlassKit repo. The internal
rendering now uses the SDF lens displacement map (curvature-blended profile,
depth band) with blur/saturation/brightness applied inside the SVG filter
graph and RGB-split chromatic dispersion.

### Breaking changes

- New `optics` prop replaces the per-knob props on `GlassSurface` and every
  ready-made component (`GlassButton`, `GlassCard`, `GlassNavBar`,
  `GlassTabBar`, `GlassPill`):

  ```tsx
  // before
  <GlassSurface blur={12} saturation={140} displacementScale={70} />

  // after
  import { DEFAULT_OPTICS } from 'nico-glass-kit';
  <GlassSurface optics={{ ...DEFAULT_OPTICS, blur: 12, saturation: 140 }} />
  ```

  Removed: `blur`, `saturation`, `displacementScale`, `aberrationIntensity`,
  `bezelWidth`, `profile`. Kept as separate props: `cornerRadius`,
  `highlightIntensity`, `elasticity`, `quality`, `overLight`.

  The nine adjustable knobs and their defaults (Blur 4px, Saturation 100%,
  Brightness 1.1, Tint `light-dark(rgb(255 255 255), rgb(18 20 26))`,
  Tint strength 0.2, Refraction 1, Depth 10px, Curvature 0.49,
  Dispersion 0.1) come from `DEFAULT_OPTICS` in `src/core/optics.ts`.

- Removed the Snell/surface-profile engine and its public exports
  (`surfaceProfiles`, `resolveSurfaceProfile`, `SurfaceProfileFn`,
  `SurfaceProfileName`). Refraction shape is now controlled by the
  `refraction` / `depth` / `curvature` optics.

- Removed exports: `aberrationIntensity` plumbing and the old
  `getDisplacementMap`/`displacementMapCacheKey` API. New exports:
  `DEFAULT_OPTICS`, `resolveOptics`, `opticsToCssVars`, `generateLensMap`,
  `clearLensMapCache`, `lensMapCacheStats`, `GlassOptics`, `GlassExtras`,
  `LensMapOptions`, `LensMapResult`.

### Playground

The control panel is grouped into 渲染 Quality / 背景 Background /
材质 Material / 折射 Refraction / 交互 Interaction / 形状 Shape / 预设
Presets, with the ported defaults and reference presets (含蓄 Subtle /
默认 Default / 清透 Clear / 夸张 Vivid).
