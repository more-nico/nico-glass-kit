# nico-glass-kit

Apple-style glass (iOS 26 feel) as React components — real displacement
refraction, not just blur.

[中文说明](README.zh-CN.md) · MIT · React 18+

![Dragging the hero glass card, with refraction and rim light following the pointer](assets/hero.gif)

## What it is

A small component kit that renders the frosted, refracting panes of the iOS 26
visual language in the browser. Every surface is a real glass element: a
`backdrop-filter` that runs an SVG displacement graph, so the backdrop bends
along the rounded edges of the pane instead of just blurring. The material is
fully parameterised — blur, tint, refraction depth, bevel profile, dispersion —
and pointer proximity drives an elasticity spring and a rim-light glint.

The kit is deliberately dependency-free: React is a peer dependency, everything
else ships as plain TS + CSS.

## Features

- **Real refraction.** The backdrop is displaced by a signed-distance-field map
  generated per corner radius, so the rim bends like a bevel. Dispersion (RGB
  split) is available on the high tier.
- **Tiered rendering with automatic degradation.** `high → medium → low`
  depending on what the browser can actually do; a browser without
  `backdrop-filter: url()` gets a plain CSS backdrop chain instead of a broken
  surface.
- **Per-element light/dark adaptation.** `overLight="auto"` samples the
  luminance of the pixels painted beneath each surface and flips that element's
  text, tint, rim and shadow, with hysteresis so it does not chatter.
- **`GlassLightGroup`.** Binds several auto elements into one recognition group
  so a row or a floating bar resolves a single decision instead of flickering
  element by element.
- **SSR-safe.** No `window`/`document` at module scope; the first client render
  is always the low tier with a dark fallback and upgrades in an effect.
- **18 ready-made components** built on one primitive, all accepting the same
  material props.

## Requirements

- React 18 or newer.
- Chromium-based browser for the refraction pass. Firefox and Safari fall back
  to the low tier (a normal `backdrop-filter` chain) automatically.

## Install

The package is **not published to npm yet**, so install it from the repository:

```bash
npm install github:more-nico/nico-glass-kit
```

A `prepare` script builds `dist/` during install, so no extra step is needed.

To work on the kit itself, use a checkout instead and point your app at it (the
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
glass component. The stylesheet import (`nico-glass-kit/style.css`) carries the
tokens and the layer CSS and is required.

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

- `'auto'` (default) samples the backdrop under each element and resolves Light
  or Dark per element, throttled and hysteresis-stabilised. Backdrops it cannot
  read (cross-origin iframes, non-CORS images) fall back to
  `prefers-color-scheme`.
- `true` / `false` pin the mode and opt the element out of probing.

Wrap neighbouring auto elements in `GlassLightGroup` when they should agree —
a toolbar row, a tab bar, a footer — so the whole strip flips at once.

## Components

| Component | What it is |
| --- | --- |
| [`GlassSurface`](src/core/GlassSurface.tsx) | The primitive every other component wraps: layer stack, optics, probing, elasticity. |
| [`GlassProvider`](src/core/GlassProvider.tsx) | Global defaults plus the SVG filter registry. |
| [`GlassLightGroup`](src/core/GlassLightGroup.tsx) | Shares one light/dark decision across bound elements. |
| [`GlassButton`](src/components/GlassButton.tsx) | Capsule and round icon buttons, hover brightness, press rebound. |
| [`GlassCard`](src/components/GlassCard.tsx) | Large-radius glass panel with a scrollable content layer. |
| [`GlassNavBar`](src/components/GlassNavBar.tsx) | Floating three-part top bar (leading / title / trailing). |
| [`GlassTabBar`](src/components/GlassTabBar.tsx) | Bottom tab bar with the sliding active capsule. |
| [`GlassPill`](src/components/GlassPill.tsx) | Floating notification capsule / toast with enter and exit animation. |
| [`GlassInput`](src/components/GlassInput.tsx) | Text field with leading/trailing slots, sizes and an invalid state. |
| [`GlassSelect`](src/components/GlassSelect.tsx) | Custom glass listbox whose popup mirrors the trigger radius and motion. |
| [`GlassSwitch`](src/components/GlassSwitch.tsx) | Switch with the state fill in the content layer. |
| [`GlassCheckbox`](src/components/GlassCheckbox.tsx) | Checkbox with a glass mark. |
| [`GlassSlider`](src/components/GlassSlider.tsx) | Native range restyled onto a frosted inset rail. |
| [`GlassSegmentedControl`](src/components/GlassSegmentedControl.tsx) | Inline capsule picker sharing the tab-bar active-pill language. |
| [`GlassBadge`](src/components/GlassBadge.tsx) | Status label with a tone dot. |
| [`GlassAvatar`](src/components/GlassAvatar.tsx) | Image or initials inside the glass rim. |
| [`GlassProgress`](src/components/GlassProgress.tsx) | Progress bar on the shared control rail. |
| [`GlassSpinner`](src/components/GlassSpinner.tsx) | Loading ring. |
| [`GlassAlert`](src/components/GlassAlert.tsx) | Tone-aware inline alert with optional dismiss. |
| [`GlassModal`](src/components/GlassModal.tsx) | Animated modal panel, closed by Esc or backdrop click. |
| [`GlassTooltip`](src/components/GlassTooltip.tsx) | Hover/focus bubble in four placements. |

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

The playground in `playground/` runs the components against animated and
photographic backdrops and drives every material parameter from the right-hand
panel. Its interface is in Chinese.

```bash
npm run dev   # http://localhost:5173
```

### More demos

**GlassButton** — hover brightening, press rebound, icon and disabled states.

![Hovering capsule and icon buttons](assets/button.gif)

**GlassCard** — pointer sweeping the rim: glint and elastic displacement.

![Pointer sweeping a glass card](assets/card.gif)

**GlassNavBar & GlassTabBar** — a floating top bar and tab bar over a scrolling
feed, with the bars re-resolving light/dark as the content moves under them.

![Scrolling a feed inside the device frame](assets/device.gif)

**GlassInput & GlassSelect** — typing, clearing, and the glass listbox with
option highlights that follow the pointer.

![Typing in an input and opening a select](assets/input.gif)

**GlassSwitch & GlassCheckbox & GlassSlider & GlassSegmentedControl** —
selection controls; every state fill lives in the content layer.

![Toggling switches, checkboxes, a slider and segmented controls](assets/selection.gif)

**GlassBadge & GlassAvatar & GlassProgress & GlassSpinner** — status and
feedback elements.

![Badges, avatars, progress bars and spinners](assets/indicator.gif)

**GlassAlert & GlassTooltip & GlassModal** — tooltips, a dismissible alert and
the modal panel.

![Tooltips, an alert and a modal](assets/overlay.gif)

## Development

```bash
npm run dev        # playground dev server
npm run typecheck  # tsc --noEmit, covers src/ and playground/
npm test           # vitest, node environment, pure functions only
npm run build      # bundles the library (dist/), not the playground
```

The test suite runs in a node environment, so only pure functions are covered —
the displacement encoding, the filter graph, optics merging, the backdrop probe
scheduler. Anything that needs a canvas or a compositor has to be verified in
the playground.

## Notes and limitations

- Backdrop probing approximates the real pixels: radial gradients use the
  farthest-corner stop, corner-keyword linear gradients are approximated as
  45° diagonals, and `url()` backgrounds are sampled only when CORS-clean.
  Unreadable backdrops fall back to `prefers-color-scheme`.
- `iframe`, `object`, `embed`, `video` and `canvas` are treated as opaque: their
  sample points are dropped rather than trusting the element's own CSS
  background.
- Backdrop filters drop any other function in a chain containing `url()`, so
  blur and saturation are emitted inside the SVG graph rather than in CSS.
- The displacement map handed to the filter is intentionally downscaled
  (`lensMapRasterScale`, default `0.2`, range `0.1`–`0.5`): the refraction rim
  softens slightly in exchange for much cheaper compositor preparation.

## License

MIT. See [package.json](package.json).

The demo GIFs in `assets/` are recordings of the playground and use a
third-party illustration as a backdrop purely for demonstration; that artwork
belongs to its respective rights holders and is not part of the package.
