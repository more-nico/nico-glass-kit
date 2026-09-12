# Changelog

## Unreleased

### Performance

- `overLight: 'auto'` backdrop probing now runs through one shared scheduler
  (`backdropProbeScheduler.ts`) instead of per-element listener sets: one
  scroll/resize/visibility/MutationObserver subscription for the whole page,
  all pending probes batched into a single rAF pass with a ~6 ms per-frame
  time budget. The library's own high-frequency writes no longer trigger
  probes: `style` mutations on the internal layers (rim-light specular vars,
  the elasticity spring's transform, tier/hover chain swaps) and everything
  inside the hidden filter-registry SVG are ignored, while class swaps,
  `data-ngs-light` flips and childList changes still pass through. Scrolls
  that cannot change an element's backdrop are skipped: elements that moved
  along with the scrolled content, and scrollers that do not overlap the
  element. Light/Dark decisions, thresholds and hysteresis are unchanged.
- Custom `url()` backgrounds no longer freeze the main thread: the probe
  re-read `cs.backgroundImage` for every sample point and re-parsed the
  layer — with a multi-megabyte data-URL wallpaper that alone cost ~1.5 s
  per probe. The per-node analysis (string materialisation, first-layer
  extraction, gradient parsing, `cover/center` detection) is now cached in
  a WeakMap invalidated by the scheduler's mutation/resize triggers, and
  `firstImageLayer`/`extractUrl` take a fast path for leading `url(...)`
  layers (slice to the closing paren, quote unwrap without regex). Measured
  on the playground with a 3.5 MB PNG wallpaper: 1499 ms → 0.95 ms per
  warm probe; scroll scenarios report zero long tasks.
- The SVG filter region shrank from `blur×1.5 + |displacement scale| +
  dispersion + 2` (~56 px per side at the defaults) to `max(blur×1.5, 4) + 2`
  (~7 px): the displacement map only ever samples inward and the
  backdrop-filter output is clipped to the element's rounded border box, so
  the outer band was never read. Filter texture area for small elements
  drops several-fold.
- Hover brightness boosts no longer rebuild the filter graph. The graph now
  carries a (possibly identity) brightness `feComponentTransfer` for
  boost-capable surfaces, and `setBrightness` retunes its `feFunc` slopes in
  place — the same mechanism the elasticity spring uses for displacement
  scales. Low tier rewrites its CSS chain directly on the effect layer.
  Neither path re-renders React or re-acquires filters.
- Chromatic dispersion is now high tier only, as documented in `optics.ts`;
  Medium renders a single displacement pass (~40% fewer graph primitives).
  Explicitly opt into `quality="high"` for the full dispersion look.

### Notes / limitations

- Surfaces with a `hoverBrightnessBoost` use private filter entries on
  Medium (identical-geometry sharing would leak the boosted brightness to
  sibling elements); non-interactive surfaces keep sharing.
- If the quality tier or optics change while a pointer hovers a surface,
  the hover brightness boost reapplies on the next pointer enter.
- Glass surfaces' internal `style` writes are invisible to the probe
  scheduler; a glass element stacked on another glass surface still sees
  its `data-ngs-light` and class changes, but not its content's inline
  style churn.

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
