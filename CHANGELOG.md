# Changelog

## 0.3.0

### Breaking changes

- `overLight: 'auto'` no longer follows `prefers-color-scheme`. Every glass
  element now samples the luminance of the backdrop actually painted beneath
  itself and picks Light/Dark per element: a small interior grid of
  `document.elementsFromPoint` hits is composited from computed background
  colors and gradients (evaluated per sample point). Content tone follows the
  resolved mode through the existing tokens — Light surfaces get near-black
  text/icons, Dark surfaces white. `prefers-color-scheme` remains only as the
  fallback when nothing readable is behind the element (SSR, first render,
  offscreen). Explicit `overLight={true/false}` still hard-overrides.
- `GlassButton.css` no longer sets `color: inherit` on the button (it
  overrode the surface's mode-aware `--ngs-text` and left button text/icons
  at the page's inherited color — white-on-white over light glass). Button
  content now defaults to `--ngs-text`; a page can still override per
  button. The `feed-tab-btn` color workaround in the playground is removed.

### Added

- `--ngs-focus-ring` token (near-white over dark, near-black over light),
  replacing the hardcoded white focus outlines on `GlassButton` /
  `GlassTabBar` so focus rings flip with the resolved mode.

### Notes / limitations

- Backdrop probing approximates the real pixels: radial gradients use the
  farthest-corner default, corner-keyword linear gradients approximate their
  45° diagonal, and `url()` backgrounds are sampled per pixel only when
  CORS-clean (data:, same-origin, or CORS-enabled) — otherwise the layer is
  skipped and compositing continues underneath. Ancestor glass surfaces
  contribute their tint layer, not their backdrop-filter output.
- Elements whose painted content is unknowable — `iframe`, `object`,
  `embed`, `video`, `canvas` — are treated as opaque unknown: sample points
  hitting them are dropped instead of trusting the element's own CSS
  background (which lies, e.g. a white placeholder behind a dark remote
  page). When every point of an element is dropped it falls back to
  `prefers-color-scheme` until a readable backdrop returns.
- Re-probes are throttled (rAF + 120 ms trailing) and run on scroll, resize,
  element resize, DOM mutations (e.g. background switches that never scroll)
  and background-image decode; probing pauses while the tab is hidden. A
  ±0.03 luminance hysteresis keeps modes stable at the threshold.

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

  The nine adjustable knobs and their defaults (Blur 3px, Saturation 100%,
  Brightness 1.1, Tint `light-dark(rgb(255 255 255), rgb(18 20 26))`,
  Tint strength 0.2, Refraction 1, Depth 8px, Curvature 0.2,
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

### Added

- `hoverBrightnessBoost`: while the pointer hovers the surface, brightness
  becomes `optics.brightness + hoverBrightnessBoost` (rim-light glint
  unchanged). `GlassSurface` defaults to 0 (off); `GlassButton` defaults to
  0.5; `GlassTabBar`, `GlassCard`, `GlassNavBar` and `GlassPill` accept the
  prop (off unless set). Works on every quality tier — high/medium swap the
  filter graph, low rewrites the backdrop chain.

### Playground

The control panel is grouped into 渲染 Quality / 背景 Background /
材质 Material / 折射 Refraction / 交互 Interaction / 形状 Shape / 预设
Presets, with the ported defaults and reference presets (含蓄 Subtle /
默认 Default / 清透 Clear / 夸张 Vivid).
