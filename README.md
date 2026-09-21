<div align="center">

# nico-glass-kit

**Apple-style glass (iOS 26 feel) as React components — real displacement refraction, not just blur.**

[![npm version][npm-shield]][npm-url]
[![license: MIT][license-shield]][license-url]
[![react >= 18][react-shield]][react-url]
[![runtime deps: 0][deps-shield]][deps-url]
[![live demo][demo-shield]][demo-url]

[Live demo][demo-url] · [中文说明](README.zh-CN.md) · [Changelog](CHANGELOG.md)

</div>

<p align="center">
  <img src="assets/hero.gif" width="860" alt="Dragging the hero glass card, with refraction and rim light following the pointer" />
</p>

---

## Contents

- [What it is](#what-it-is)
- [Highlights](#highlights)
- [Install](#install)
- [Quick start](#quick-start)
- [Rendering tiers](#rendering-tiers)
- [Light and dark](#light-and-dark)
- [Components](#components)
- [Playground](#playground)
- [Component gallery](#component-gallery)
- [Development](#development)
- [Notes and limitations](#notes-and-limitations)
- [License](#license)

## What it is

A component kit that renders the frosted, refracting panes of the iOS 26
visual language in the browser. Every surface is a real glass element: a
`backdrop-filter` running an SVG displacement graph, so the backdrop bends
along the rounded edges of the pane instead of just blurring. The material is
fully parameterised — blur, tint, refraction depth, bevel profile, dispersion —
and pointer proximity drives an elasticity spring and a rim-light glint.

Zero runtime dependencies: React is a peer dependency, everything else ships
as plain TypeScript + CSS.

## Highlights

- **Real refraction.** The backdrop is displaced by a signed-distance-field map
  generated per corner radius, so the rim bends like a bevel. Chromatic
  dispersion (RGB split) is available on the high tier.
- **Tiered rendering with automatic degradation.** `high → medium → low`
  depending on what the browser can actually run; without
  `backdrop-filter: url()` you get a plain CSS backdrop chain, never a broken
  surface.
- **Per-element light/dark adaptation.** `overLight="auto"` samples the
  luminance of the pixels painted beneath each surface and flips that element's
  text, tint, rim and shadow — with hysteresis, so it does not chatter.
- **`GlassLightGroup`.** Binds several auto elements into one recognition group,
  so a row or a floating bar resolves a single decision instead of flickering
  element by element.
- **SSR-safe.** No `window`/`document` at module scope; the first client render
  is always the low tier with a dark fallback, and upgrades in an effect.
- **18 ready-made components** built on one primitive, all accepting the same
  material props.

## Requirements

- React 18 or newer.
- A Chromium-based browser for the refraction pass. Firefox and Safari fall
  back to the low tier (a normal `backdrop-filter` chain) automatically.

## Install

```bash
npm install nico-glass-kit
```

To track the repository instead of a release, install from GitHub — a
`prepare` script builds `dist/` during install:

```bash
npm install github:more-nico/nico-glass-kit
```

To work on the kit itself, use a checkout and point your app at it (the
package publishes `dist/` only):

```bash
git clone https://github.com/more-nico/nico-glass-kit.git
cd nico-glass-kit
npm install
npm run build
npm install /path/to/nico-glass-kit
```

## Quick start

```tsx
import { GlassProvider, GlassCard, GlassButton } from 'nico-glass-kit';
import 'nico-glass-kit/style.css';

export function Demo() {
  return (
    <GlassProvider quality="high" overLight="auto">
      <GlassCard cornerRadius={24}>
        <GlassButton>New project</GlassButton>
      </GlassCard>
    </GlassProvider>
  );
}
```

`GlassProvider` mounts the shared SVG filter registry, so it has to wrap every
glass component. The stylesheet import (`nico-glass-kit/style.css`) carries
the design tokens and the layer CSS, and is required.

## Rendering tiers

| Tier | What runs |
| --- | --- |
| `low` | Plain CSS `backdrop-filter` chain (blur / saturate / brightness). Also the first client render and the fallback when SVG backdrop filters are unavailable. |
| `medium` | One displacement pass through the SVG filter graph. |
| `high` | Dispersion: RGB split with three displacement passes, pointer elasticity and hover brightness. |

Ask for a tier with `quality` on the provider or on a single surface; the kit
degrades it down the chain when the browser cannot run it.

## Light and dark

`overLight` accepts `true`, `false` or `'auto'`:

- `'auto'` (default) samples the backdrop under each element and resolves
  Light or Dark per element, throttled and hysteresis-stabilised. Backdrops it
  cannot read (cross-origin iframes, non-CORS images) fall back to
  `prefers-color-scheme`.
- `true` / `false` pin the mode and opt the element out of probing.

Wrap neighbouring auto elements in `GlassLightGroup` when they should agree —
a toolbar row, a tab bar, a footer — so the whole strip flips at once.

## Components

### Core

| Component | What it is |
| --- | --- |
| [`GlassSurface`](src/core/GlassSurface.tsx) | The primitive every other component wraps: layer stack, optics, probing, elasticity. |
| [`GlassProvider`](src/core/GlassProvider.tsx) | Global defaults plus the SVG filter registry. |
| [`GlassLightGroup`](src/core/GlassLightGroup.tsx) | Shares one light/dark decision across bound elements. |

### Buttons & navigation

| Component | What it is |
| --- | --- |
| [`GlassButton`](src/components/GlassButton.tsx) | Capsule and round icon buttons, hover brightness, press rebound. |
| [`GlassNavBar`](src/components/GlassNavBar.tsx) | Floating three-part top bar (leading / title / trailing). |
| [`GlassTabBar`](src/components/GlassTabBar.tsx) | Bottom tab bar with the sliding active capsule. |
| [`GlassSegmentedControl`](src/components/GlassSegmentedControl.tsx) | Inline capsule picker sharing the tab-bar active-pill language. |

### Forms & controls

| Component | What it is |
| --- | --- |
| [`GlassInput`](src/components/GlassInput.tsx) | Text field with leading/trailing slots, sizes and an invalid state. |
| [`GlassSelect`](src/components/GlassSelect.tsx) | Custom glass listbox whose popup mirrors the trigger radius and motion. |
| [`GlassSwitch`](src/components/GlassSwitch.tsx) | Switch with the state fill in the content layer. |
| [`GlassCheckbox`](src/components/GlassCheckbox.tsx) | Checkbox with a glass mark. |
| [`GlassSlider`](src/components/GlassSlider.tsx) | Native range restyled onto a frosted inset rail. |

### Status & feedback

| Component | What it is |
| --- | --- |
| [`GlassBadge`](src/components/GlassBadge.tsx) | Status label with a tone dot. |
| [`GlassAvatar`](src/components/GlassAvatar.tsx) | Image or initials inside the glass rim. |
| [`GlassProgress`](src/components/GlassProgress.tsx) | Progress bar on the shared control rail. |
| [`GlassSpinner`](src/components/GlassSpinner.tsx) | Loading ring. |
| [`GlassText`](src/components/GlassText.tsx) | Glyph-shaped glass for all 95 printable ASCII characters. |
| [`GlassAlert`](src/components/GlassAlert.tsx) | Tone-aware inline alert with optional dismiss. |

### Panels & overlays

| Component | What it is |
| --- | --- |
| [`GlassCard`](src/components/GlassCard.tsx) | Large-radius glass panel with a scrollable content layer. |
| [`GlassPill`](src/components/GlassPill.tsx) | Floating notification capsule / toast with enter and exit animation. |
| [`GlassModal`](src/components/GlassModal.tsx) | Animated modal panel, closed by Esc or backdrop click. |
| [`GlassTooltip`](src/components/GlassTooltip.tsx) | Hover/focus bubble in four placements. |

### Glass text

Each visible glyph is a `GlassSurface` with a glyph mask and distance field. Optical parameters retain the same meaning as other surfaces; there is no text-specific brightness boost or refraction reduction. Spaces advance without painting. `tabularNums` uses the widest of all ten digits. Font loading and responsive sizes rebuild the geometry; SSR and canvas failures retain readable text.

```tsx
<GlassText text="01:00" fontSize={132} fontWeight={600} tabularNums />
<GlassText text="B8@%" optics={{ refraction: 1, depth: 8 }} />
```

### Props shared by every component

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `quality` | `'low' \| 'medium' \| 'high'` | provider value | Per-surface tier override; still degrades automatically. |
| `overLight` | `boolean \| 'auto'` | `'auto'` | Light/dark adaptation for this element. |
| `optics` | `Partial<GlassOptics>` | — | Sparse overrides merged over the defaults below. |
| `elasticity` | `number` (0–1) | `0.2` | Pointer spring (high tier); `0` is rigid. |
| `highlightIntensity` | `number` | `1` | Rim-light multiplier; the glint follows the pointer. |
| `hoverBrightnessBoost` | `number` | `0` | Extra brightness while hovered. `GlassButton` sets `0.5`. |
| `cornerRadius` | `number` | `20` | Component-level corner radius. |

### Optics

| Key | Default | Meaning |
| --- | --- | --- |
| `blur` | `3` | Backdrop blur radius in px. |
| `saturation` | `100` | Saturation percentage. |
| `brightness` | `1.1` | Brightness multiplier. |
| `tint` | `light-dark(rgb(255 255 255), rgb(18 20 26))` | Base tint colour. |
| `tintStrength` | `0.2` | Tint strength, 0–1. |
| `refraction` | `1` | Refraction strength, mapped to the displacement scale. |
| `depth` | `8` | Refraction band width in px. |
| `curvature` | `0.2` | Bevel profile: `0` bucket, `1` squircle. |
| `dispersion` | `0.1` | Chromatic dispersion, high tier only. |

## Playground

The playground in `playground/` runs the components over five built-in
backdrops — animated aurora, sunset and ocean scenes, a dense text wall, and
Vincent van Gogh's *The Starry Night* (public domain) — plus any image you
upload. The right-hand panel drives every material parameter live, and an FPS
meter tracks what each tier costs. Its interface is in Chinese.

A hosted copy runs at **[nico-glass-kit.vercel.app][demo-url]**.

```bash
npm run dev              # local playground at http://localhost:5173
npm run build:playground # static build into playground/dist (what Vercel deploys)
```

## Component gallery

**`GlassButton`** — hover brightening, press rebound, icon and disabled states.

<p align="center">
  <img src="assets/button.gif" width="760" alt="Hovering capsule and icon buttons" />
</p>

**`GlassCard`** — pointer sweeping the rim: glint and elastic displacement.

<p align="center">
  <img src="assets/card.gif" width="760" alt="Pointer sweeping a glass card" />
</p>

**`GlassNavBar` & `GlassTabBar`** — a floating top bar and tab bar over a
scrolling feed, re-resolving light/dark as the content moves beneath them.

<p align="center">
  <img src="assets/device.gif" width="760" alt="Scrolling a feed inside the device frame" />
</p>

**`GlassInput` & `GlassSelect`** — typing, clearing, and the glass listbox
with option highlights that follow the pointer.

<p align="center">
  <img src="assets/input.gif" width="760" alt="Typing in an input and opening a select" />
</p>

**`GlassSwitch` & `GlassCheckbox` & `GlassSlider` & `GlassSegmentedControl`** —
selection controls; every state fill lives in the content layer.

<p align="center">
  <img src="assets/selection.gif" width="760" alt="Toggling switches, checkboxes, a slider and segmented controls" />
</p>

**`GlassBadge` & `GlassAvatar` & `GlassProgress` & `GlassSpinner`** — status
and feedback elements.

<p align="center">
  <img src="assets/indicator.gif" width="760" alt="Badges, avatars, progress bars and spinners" />
</p>

**`GlassAlert` & `GlassTooltip` & `GlassModal`** — tooltips, a dismissible
alert and the modal panel.

<p align="center">
  <img src="assets/overlay.gif" width="760" alt="Tooltips, an alert and a modal" />
</p>

## Development

```bash
npm run dev              # playground dev server
npm run typecheck        # tsc --noEmit, covers src/ and playground/
npm test                 # vitest, node environment, pure functions only
npm run build            # bundles the library (dist/), not the playground
npm run build:playground # bundles the playground (playground/dist)
```

The test suite runs in a node environment, so only pure functions are
covered — the displacement encoding, the filter graph, optics merging, the
backdrop probe scheduler. Anything that needs a canvas or a compositor has to
be verified in the playground.

## Notes and limitations

- Backdrop probing approximates the real pixels: radial gradients use the
  farthest-corner stop, corner-keyword linear gradients are approximated as
  45° diagonals, and `url()` backgrounds are sampled only when CORS-clean.
  Unreadable backdrops fall back to `prefers-color-scheme`.
- `iframe`, `object`, `embed`, `video` and `canvas` are treated as opaque:
  their sample points are dropped rather than trusting the element's own CSS
  background.
- Backdrop filters drop any other function in a chain containing `url()`, so
  blur and saturation are emitted inside the SVG graph rather than in CSS.
- The displacement map handed to the filter is intentionally downscaled
  (`lensMapRasterScale`, default `0.2`, range `0.1`–`0.5`): the refraction rim
  softens slightly in exchange for much cheaper compositor preparation.

## License

[MIT](LICENSE).

The playground ships one bundled background wallpaper — Vincent van Gogh's
*The Starry Night* (1889), taken from Wikimedia Commons — which is in the
public domain.

The demo GIFs in `assets/` are recordings of the playground and use a
third-party illustration as a backdrop purely for demonstration; that artwork
belongs to its respective rights holders and is not part of the package.

<p align="right"><a href="#top">Back to top ↑</a></p>

<!-- badge links -->

[npm-shield]: https://img.shields.io/npm/v/nico-glass-kit?style=flat-square&color=cb3837
[npm-url]: https://www.npmjs.com/package/nico-glass-kit
[license-shield]: https://img.shields.io/badge/license-MIT-22c55e?style=flat-square
[license-url]: LICENSE
[react-shield]: https://img.shields.io/badge/react-%E2%89%A5%2018-61DAFB?style=flat-square
[react-url]: https://react.dev
[deps-shield]: https://img.shields.io/badge/runtime%20deps-0-brightgreen?style=flat-square
[deps-url]: #what-it-is
[demo-shield]: https://img.shields.io/badge/demo-online-0ea5e9?style=flat-square
[demo-url]: https://nico-glass-kit.vercel.app/
