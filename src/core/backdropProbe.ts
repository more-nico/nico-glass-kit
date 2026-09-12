/**
 * Backdrop luminance probing for `overLight: 'auto'`.
 *
 * A glass element decides Light vs Dark from what is actually painted
 * beneath it. Arbitrary DOM cannot be rasterized, so the probe approximates
 * the backdrop from the paint layers the browser reports: a small interior
 * grid of `document.elementsFromPoint` hits, compositing each element's
 * computed background-color and — for gradients — the gradient colour
 * evaluated at the sample point. `url()` images are sampled from a decoded
 * copy when CORS-clean (data:, same-origin, or CORS-enabled); otherwise the
 * layer is skipped and compositing continues underneath.
 *
 * The colour math is kept DOM-free so it can run in node tests; only the
 * bottom section touches the DOM.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  width: number;
  height: number;
}

/**
 * Backdrop relative luminance at/above this counts as Light. Between the
 * contrast-optimal crossover (~0.18) and the naive midpoint (0.5): the glass
 * itself brightens the backdrop (brightness 1.1 + white tint), so the raw
 * backdrop can afford to read darker before Dark mode wins. Tuned on the
 * playground presets: every aurora/ocean/text sample stays well below it,
 * while the bright sunset floor (~0.37) crosses it.
 */
export const LIGHT_LUMINANCE_THRESHOLD = 0.3;

const HYSTERESIS = 0.03;
const GRID_FRACTIONS = [0.2, 0.5, 0.8];
const MAX_LAYERS_PER_POINT = 24;

/* ------------------------------------------------------------------ */
/* Colour math (pure)                                                  */
/* ------------------------------------------------------------------ */

const HEX_RE = /^#([\da-f]{3,8})$/i;
const RGB_RE = /^rgba?\(([^()]*)\)$/i;

/** Parses `#rgb/#rgba/#rrggbb/#rrggbbaa`, `rgb()/rgba()` (legacy and modern space syntax) and `transparent`. */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = HEX_RE.exec(s);
  if (hex) {
    const d = hex[1];
    if (d.length === 3 || d.length === 4) {
      const p = [...d].map((c) => parseInt(c + c, 16));
      return { r: p[0], g: p[1], b: p[2], a: d.length === 4 ? p[3] / 255 : 1 };
    }
    if (d.length === 6 || d.length === 8) {
      return {
        r: parseInt(d.slice(0, 2), 16),
        g: parseInt(d.slice(2, 4), 16),
        b: parseInt(d.slice(4, 6), 16),
        a: d.length === 8 ? parseInt(d.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = RGB_RE.exec(s);
  if (!fn) return null;
  const segments = splitTopLevel(fn[1], '/');
  const rgbPart = segments[0];
  const channels = (
    rgbPart.includes(',') ? splitTopLevel(rgbPart, ',') : splitTopLevel(rgbPart, ' ')
  )
    .map((t) => t.trim())
    .filter(Boolean);
  if (channels.length !== 3 && channels.length !== 4) return null;
  const r = parseChannel255(channels[0]);
  const g = parseChannel255(channels[1]);
  const b = parseChannel255(channels[2]);
  if (r === null || g === null || b === null) return null;
  const alphaToken: string | null =
    segments.length > 1 ? segments[1] : channels.length === 4 ? channels[3] : null;
  let a = 1;
  if (alphaToken !== null) {
    const parsed = parseAlpha(alphaToken.trim());
    if (parsed === null) return null;
    a = parsed;
  }
  return { r, g, b, a };
}

function parseChannel255(token: string): number | null {
  const t = token.trim();
  if (t.endsWith('%')) {
    const v = Number.parseFloat(t);
    return Number.isFinite(v) ? clamp255(v * 2.55) : null;
  }
  const v = Number.parseFloat(t);
  return Number.isFinite(v) ? clamp255(v) : null;
}

function parseAlpha(token: string): number | null {
  if (token.endsWith('%')) {
    const v = Number.parseFloat(token);
    return Number.isFinite(v) ? clamp01(v / 100) : null;
  }
  const v = Number.parseFloat(token);
  return Number.isFinite(v) ? clamp01(v) : null;
}

/** Standard alpha-over compositing (non-premultiplied inputs/outputs). */
export function compositeOver(front: Rgba, back: Rgba): Rgba {
  const a = front.a + back.a * (1 - front.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (f: number, b: number) => (f * front.a + b * back.a * (1 - front.a)) / a;
  return {
    r: clamp255(mix(front.r, back.r)),
    g: clamp255(mix(front.g, back.g)),
    b: clamp255(mix(front.b, back.b)),
    a,
  };
}

/** WCAG relative luminance of the RGB channels (alpha ignored). */
export function relativeLuminance(color: Rgba): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
}

/**
 * Light/Dark decision with a small hysteresis band so an element sitting at
 * the threshold (e.g. during scroll) does not flip-flop between modes.
 */
export function decideLight(luminance: number, previous: boolean | null): boolean {
  if (previous === true) return luminance > LIGHT_LUMINANCE_THRESHOLD - HYSTERESIS;
  if (previous === false) return luminance > LIGHT_LUMINANCE_THRESHOLD + HYSTERESIS;
  return luminance > LIGHT_LUMINANCE_THRESHOLD;
}

/* ------------------------------------------------------------------ */
/* Group aggregation (pure)                                            */
/* ------------------------------------------------------------------ */

export interface VisibleRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Area-weighted mean of per-member luminance samples. Members with no weight
 * (fully offscreen) are ignored; returns null when nothing carried weight.
 */
export function aggregateLuminance(
  samples: ReadonlyArray<{ luminance: number; weight: number }>,
): number | null {
  let sum = 0;
  let weightSum = 0;
  for (const sample of samples) {
    if (!(sample.weight > 0)) continue;
    sum += sample.luminance * sample.weight;
    weightSum += sample.weight;
  }
  return weightSum > 0 ? sum / weightSum : null;
}

/** Bounding union of rects; null for an empty list. */
export function unionRect(rects: readonly VisibleRect[]): VisibleRect | null {
  if (!rects.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return { left, top, width: right - left, height: bottom - top };
}

/* ------------------------------------------------------------------ */
/* Gradients (pure)                                                    */
/* ------------------------------------------------------------------ */

export interface ColorStop {
  color: Rgba;
  /** Fraction along the gradient line; null until fillStopPositions runs. */
  pos: number | null;
}

export type GradientSpec =
  | { kind: 'linear'; angleDeg: number; stops: ColorStop[] }
  | { kind: 'radial'; shape: 'circle' | 'ellipse'; cx: number; cy: number; stops: ColorStop[] };

/**
 * Parses a single computed background-image layer as a linear/radial
 * gradient. Corner keywords (`to top right` & co) are approximated by their
 * 45° diagonal — the exact spec angle depends on the box aspect, which
 * luminance probing does not need. Explicit radial sizes and px positions
 * fall back to the farthest-corner ellipse / centre respectively.
 */
export function parseGradient(layer: string): GradientSpec | null {
  const s = layer.trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('linear-gradient(') && s.endsWith(')')) {
    const args = splitTopLevel(s.slice(16, -1), ',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (args.length < 2) return null;
    let angleDeg = 180; // CSS default when no angle/`to` direction is given
    let stopArgs = args;
    const toAngle = parseToAngle(args[0]);
    if (toAngle !== null) {
      angleDeg = toAngle;
      stopArgs = args.slice(1);
    } else if (!args[0].includes('%')) {
      const angle = parseAngle(args[0]);
      if (angle !== null) {
        angleDeg = angle;
        stopArgs = args.slice(1);
      }
    }
    const stops = parseStops(stopArgs);
    return stops ? { kind: 'linear', angleDeg, stops } : null;
  }
  if (lower.startsWith('radial-gradient(') && s.endsWith(')')) {
    const args = splitTopLevel(s.slice(16, -1), ',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (args.length < 2) return null;
    let shape: 'circle' | 'ellipse' = 'ellipse';
    let cx = 0.5;
    let cy = 0.5;
    let stopArgs = args;
    const head = args[0];
    const isGeometry =
      /\b(circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner)\b/i.test(head) ||
      /\bat\b/i.test(head);
    if (isGeometry) {
      const at = /\bat\s+(.+)$/i.exec(head);
      if (at) {
        const pos = parsePosition(at[1]);
        if (pos) {
          cx = pos.x;
          cy = pos.y;
        }
      }
      if (/\bcircle\b/i.test(head)) shape = 'circle';
      stopArgs = args.slice(1);
    }
    const stops = parseStops(stopArgs);
    return stops ? { kind: 'radial', shape, cx, cy, stops } : null;
  }
  return null;
}

const SIDE_ANGLES: Record<string, number> = { top: 0, right: 90, bottom: 180, left: 270 };

function parseToAngle(token: string): number | null {
  const m = /^to\s+([a-z]+)(?:\s+([a-z]+))?$/i.exec(token.trim());
  if (!m) return null;
  const first = m[1].toLowerCase();
  const second = m[2]?.toLowerCase() ?? '';
  const single: number | undefined = SIDE_ANGLES[first];
  if (!second) return single ?? null;
  const vertical = first === 'top' || first === 'bottom' ? first : second;
  const horizontal = first === 'left' || first === 'right' ? first : second;
  const base: number | undefined = SIDE_ANGLES[vertical];
  const horizontalAngle: number | undefined = SIDE_ANGLES[horizontal];
  if (base === undefined || horizontalAngle === undefined) return null;
  const sameQuadrant = (vertical === 'top') === (horizontal === 'right');
  return base + (sameQuadrant ? 45 : -45);
}

const ANGLE_RE = /^(-?[\d.]+)(deg|grad|rad|turn)?$/;

function parseAngle(token: string): number | null {
  const m = ANGLE_RE.exec(token.trim());
  if (!m) return null;
  const v = Number.parseFloat(m[1]);
  if (!Number.isFinite(v)) return null;
  switch (m[2]) {
    case 'grad':
      return v * 0.9;
    case 'rad':
      return (v * 180) / Math.PI;
    case 'turn':
      return v * 360;
    default:
      return v;
  }
}

const POSITION_KEYWORDS: Record<string, number> = { left: 0, center: 0.5, right: 1, top: 0, bottom: 1 };

function parsePositionValue(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t in POSITION_KEYWORDS) return POSITION_KEYWORDS[t];
  if (t.endsWith('%')) {
    const v = Number.parseFloat(t);
    return Number.isFinite(v) ? v / 100 : null;
  }
  return null;
}

function parsePosition(str: string): { x: number; y: number } | null {
  const tokens = splitTopLevel(str, ' ')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 2) return null;
  if (tokens.length === 1) {
    const v = parsePositionValue(tokens[0]);
    if (v === null) return null;
    const isVertical = tokens[0] === 'top' || tokens[0] === 'bottom';
    return isVertical ? { x: 0.5, y: v } : { x: v, y: 0.5 };
  }
  const a = parsePositionValue(tokens[0]);
  const b = parsePositionValue(tokens[1]);
  if (a === null || b === null) return null;
  const firstVertical = tokens[0] === 'top' || tokens[0] === 'bottom';
  return firstVertical ? { x: b, y: a } : { x: a, y: b };
}

function parseStops(args: string[]): ColorStop[] | null {
  const stops: ColorStop[] = [];
  for (const arg of args) {
    const parsed = parseStop(arg);
    if (!parsed) return null;
    stops.push(...parsed);
  }
  if (!stops.length) return null;
  fillStopPositions(stops);
  return stops;
}

function parseStop(arg: string): ColorStop[] | null {
  const whole = parseCssColor(arg);
  if (whole) return [{ color: whole, pos: null }];
  const tokens = splitTopLevel(arg, ' ')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 2) return null;
  let color: Rgba | null = null;
  const positions: number[] = [];
  for (const token of tokens) {
    const c = parseCssColor(token);
    if (c) {
      if (color) return null;
      color = c;
      continue;
    }
    const t = token.toLowerCase();
    if (t.endsWith('%')) {
      const v = Number.parseFloat(t);
      if (!Number.isFinite(v)) return null;
      positions.push(clamp01(v / 100));
      continue;
    }
    return null; // px/length positions are not worth the approximation here
  }
  if (!color || !positions.length) return null;
  return positions.map((pos) => ({ color, pos }));
}

/**
 * CSS stop-position algorithm: first stop defaults to 0, last to 1, and
 * unpositioned runs spread evenly between their positioned neighbours.
 */
function fillStopPositions(stops: ColorStop[]): void {
  if (stops[0].pos === null) stops[0].pos = 0;
  const last = stops.length - 1;
  if (stops[last].pos === null) stops[last].pos = 1;
  let i = 0;
  while (i < stops.length) {
    if (stops[i].pos !== null) {
      i++;
      continue;
    }
    const runStart = i;
    while (stops[i].pos === null) i++;
    const prevPos = stops[runStart - 1].pos as number;
    const nextPos = stops[i].pos as number;
    const runLen = i - runStart + 1;
    for (let k = runStart; k < i; k++) {
      stops[k].pos = prevPos + ((nextPos - prevPos) * (k - runStart + 1)) / runLen;
    }
  }
}

/**
 * Evaluates the gradient at a box-relative sample point, normalising linear
 * gradients along the spec gradient line and radial gradients as the
 * default farthest-corner circle/ellipse.
 */
export function gradientColorAt(spec: GradientSpec, box: Box, point: Point): Rgba | null {
  const stops = spec.stops;
  if (!stops.length) return null;
  let t: number;
  if (spec.kind === 'linear') {
    const rad = (spec.angleDeg * Math.PI) / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const lineLen = Math.abs(box.width * dx) + Math.abs(box.height * dy);
    if (lineLen === 0) {
      t = 0;
    } else {
      const rel = (point.x - box.width / 2) * dx + (point.y - box.height / 2) * dy;
      t = rel / lineLen + 0.5;
    }
  } else {
    const cx = spec.cx * box.width;
    const cy = spec.cy * box.height;
    const fx = Math.max(Math.abs(cx), Math.abs(box.width - cx));
    const fy = Math.max(Math.abs(cy), Math.abs(box.height - cy));
    if (spec.shape === 'circle') {
      const r = Math.hypot(fx, fy);
      t = r === 0 ? 0 : Math.hypot(point.x - cx, point.y - cy) / r;
    } else {
      const rx = Math.hypot(fx, (fy * box.width) / box.height);
      const ry = box.height === 0 ? 0 : (rx * box.height) / box.width;
      t = rx === 0 || ry === 0 ? 0 : Math.hypot((point.x - cx) / rx, (point.y - cy) / ry);
    }
  }
  return colorAtT(stops, clamp01(t));
}

function colorAtT(stops: ColorStop[], t: number): Rgba {
  if (t <= (stops[0].pos as number)) return stops[0].color;
  const last = stops[stops.length - 1];
  if (t >= (last.pos as number)) return last.color;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    const pa = a.pos as number;
    const pb = b.pos as number;
    if (t >= pa && t <= pb) {
      const u = pb === pa ? (t >= pb ? 1 : 0) : (t - pa) / (pb - pa);
      return lerpColor(a.color, b.color, u);
    }
  }
  return last.color;
}

/** Interpolates in premultiplied sRGB (matches CSS gradient rendering). */
function lerpColor(a: Rgba, b: Rgba, u: number): Rgba {
  const al = a.a + (b.a - a.a) * u;
  if (al <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (x: number, y: number) => x * a.a + (y * b.a - x * a.a) * u;
  return {
    r: clamp255(mix(a.r, b.r) / al),
    g: clamp255(mix(a.g, b.g) / al),
    b: clamp255(mix(a.b, b.b) / al),
    a: al,
  };
}

/* ------------------------------------------------------------------ */
/* Point resolution (pure)                                             */
/* ------------------------------------------------------------------ */

/** One paintable element behind the sample point, prepared by the DOM glue. */
export interface PaintLayer {
  box: Box;
  /** Sample point relative to the layer's own box. */
  point: Point;
  backgroundColor: Rgba | null;
  gradient: GradientSpec | null;
  /** Decoded `url()` colour for this point; null while pending or unsupported. */
  imageColor: Rgba | null;
}

/**
 * Composites the paint layers front-to-back until (nearly) opaque, then
 * blends whatever remains over the page fallback. Layers without paint
 * (transparent, pending image, unsupported) are skipped, not fatal.
 */
export function resolvePointColor(layers: PaintLayer[], fallback: Rgba): Rgba {
  let acc: Rgba | null = null;
  for (const layer of layers) {
    let paint: Rgba | null = layer.backgroundColor;
    if (layer.imageColor && layer.imageColor.a > 0) {
      paint = paint ? compositeOver(layer.imageColor, paint) : layer.imageColor;
    }
    if (layer.gradient) {
      const gc = gradientColorAt(layer.gradient, layer.box, layer.point);
      if (gc && gc.a > 0) paint = paint ? compositeOver(gc, paint) : gc;
    }
    if (paint && paint.a > 0) {
      // The walk runs front-to-back, so each new layer goes BEHIND the
      // accumulator built so far.
      acc = acc ? compositeOver(acc, paint) : paint;
      if (acc.a >= 0.999) return acc;
    }
  }
  if (!acc) return fallback;
  return acc.a >= 0.999 ? acc : compositeOver(acc, fallback);
}

/* ------------------------------------------------------------------ */
/* DOM glue                                                            */
/* ------------------------------------------------------------------ */

export interface BackdropProbe {
  /** Mean WCAG luminance over the sample grid; null if nothing was readable. */
  averageLuminance: number | null;
  /** True when `url()` layers are still decoding — a re-probe will follow. */
  pendingImages: boolean;
}

/**
 * Elements whose painted content cannot be read through the DOM. They always
 * paint something opaque (iframe remote documents, media, canvas bitmaps),
 * but their real pixels are unknowable (cross-origin or bitmaps) — a hit on
 * them makes the sample point unusable rather than letting the element's own
 * CSS background (e.g. a white placeholder on an iframe) lie about the
 * actually painted dark page.
 */
const UNKNOWN_CONTENT_TAGS = new Set(['IFRAME', 'FRAME', 'OBJECT', 'EMBED', 'VIDEO', 'CANVAS']);

/**
 * Samples the painted backdrop beneath `el`. Layers in front of the element
 * (everything hit before it in paint order) are excluded, so overlays never
 * skew the reading; the element's own subtree is skipped the same way.
 * Sample points of partially visible elements are clamped into the viewport
 * (elementsFromPoint only sees on-screen content), so the mode updates as
 * soon as the element enters the view; fully offscreen elements report null
 * and keep their last decision. Points landing on unknowable opaque content
 * (see {@link UNKNOWN_CONTENT_TAGS}) are dropped; if every point is dropped
 * the probe reports a null luminance and the caller falls back to
 * `prefers-color-scheme`.
 */

/* ---------------------- per-node paint cache ------------------------ */

/**
 * Expensive per-node background analysis, cached: `cs.backgroundImage` can
 * be a multi-megabyte data URL whose string materialisation plus layer
 * parsing would otherwise repeat for every sample point of every probe.
 * Entries are invalidated wholesale by {@link invalidateBackdropPaintInfo}
 * whenever a mutation/resize may have changed what nodes paint;
 * scroll-triggered probes reuse entries without touching the strings.
 */
interface NodePaintInfo {
  image: FirstImage | null;
  gradient: GradientSpec | null;
  size: string;
  position: string;
}

let paintInfoCache = new WeakMap<Element, NodePaintInfo>();

/** Clears the per-node background analysis cache (backdrop may have changed). */
export function invalidateBackdropPaintInfo(): void {
  paintInfoCache = new WeakMap();
}

function paintInfoFor(node: Element, cs: CSSStyleDeclaration): NodePaintInfo {
  let info = paintInfoCache.get(node);
  if (!info) {
    const image = firstImageLayer(cs.backgroundImage);
    info = {
      image,
      gradient: image?.kind === 'gradient' ? parseGradient(image.layer) : null,
      size: cs.backgroundSize,
      position: cs.backgroundPosition,
    };
    paintInfoCache.set(node, info);
  }
  return info;
}

/* ---------------------- probe run helpers --------------------------- */

/** Mutable state shared by every sample point of one probe. */
interface ProbeRun {
  doc: Document;
  win: Window;
  fallback: Rgba;
  styles: Map<Element, CSSStyleDeclaration>;
  rects: Map<Element, DOMRect>;
  pendingImages: boolean;
}

function createProbeRun(doc: Document, win: Window): ProbeRun {
  return {
    doc,
    win,
    fallback: pageFallbackColor(doc),
    styles: new Map(),
    rects: new Map(),
    pendingImages: false,
  };
}

function buildLayer(
  run: ProbeRun,
  node: Element,
  cs: CSSStyleDeclaration,
  nodeRect: DOMRect,
  point: Point,
): PaintLayer {
  // The background-image analysis is served from the per-node paint cache:
  // reading `cs.backgroundImage` materialises the whole value (data URLs
  // can be megabytes) and firstImageLayer/extractUrl walk it, so doing
  // that per sample point would dominate every probe.
  const info = paintInfoFor(node, cs);
  let imageColor: Rgba | null = null;
  if (info.image && info.image.kind === 'url') {
    // The cached FirstImage holds the exact URL string object, so this
    // lookup is an identity hit instead of re-hashing megabytes per point.
    const state = requestImage(info.image.url);
    if (state === 'pending') {
      run.pendingImages = true;
    } else if (state !== 'failed') {
      // Precise pixel only for the cover+center case the playground and
      // most full-bleed backgrounds use; otherwise the whole-image average.
      const precise =
        info.size === 'cover' &&
        (info.position === 'center' ||
          info.position.includes('center') ||
          info.position.includes('50%'));
      imageColor = precise
        ? sampleImagePixel(state.img, { width: nodeRect.width, height: nodeRect.height }, point) ??
          state.average
        : state.average;
    }
  }
  return {
    box: { width: nodeRect.width, height: nodeRect.height },
    point,
    backgroundColor: parseCssColor(cs.backgroundColor),
    gradient: info.gradient,
    imageColor,
  };
}

/**
 * Turns the nodes behind a sample point into paint layers, or null when an
 * unreadable opaque layer (iframe/media/canvas) hides everything below it.
 */
function gatherLayers(
  run: ProbeRun,
  behind: readonly Element[],
  isExcluded: (node: Element) => boolean,
  point: Point,
): PaintLayer[] | null {
  const layers: PaintLayer[] = [];
  for (const node of behind) {
    if (isExcluded(node)) continue;
    if (UNKNOWN_CONTENT_TAGS.has(node.tagName)) {
      // Opaque content we cannot read: anything behind it is hidden, so
      // the sample point says nothing usable — drop it.
      return null;
    }
    let cs = run.styles.get(node);
    if (!cs) {
      cs = run.win.getComputedStyle(node);
      run.styles.set(node, cs);
    }
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let nodeRect = run.rects.get(node);
    if (!nodeRect) {
      nodeRect = node.getBoundingClientRect();
      run.rects.set(node, nodeRect);
    }
    layers.push(
      buildLayer(run, node, cs, nodeRect, {
        x: point.x - nodeRect.left,
        y: point.y - nodeRect.top,
      }),
    );
    if (layers.length >= MAX_LAYERS_PER_POINT) break;
  }
  return layers;
}

/** Runs the 3×3 interior grid over `rect`, keeping only usable points. */
function probeGrid(
  run: ProbeRun,
  rect: { left: number; top: number; width: number; height: number },
  resolveLayers: (stack: Element[], x: number, y: number) => PaintLayer[] | null,
): number[] {
  const { win } = run;
  const luminances: number[] = [];
  for (const fx of GRID_FRACTIONS) {
    for (const fy of GRID_FRACTIONS) {
      const x = Math.min(Math.max(rect.left + rect.width * fx, 0), win.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height * fy, 0), win.innerHeight - 1);
      const stack = run.doc.elementsFromPoint(x, y);
      const layers = resolveLayers(stack, x, y);
      if (!layers) continue;
      luminances.push(relativeLuminance(resolvePointColor(layers, run.fallback)));
    }
  }
  return luminances;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isWithinMembers(node: Element, members: readonly HTMLElement[]): boolean {
  for (const member of members) {
    if (node === member || member.contains(node)) return true;
  }
  return false;
}

/** Viewport-clipped area of a member rect; 0 when fully offscreen. */
function visibleRectArea(rect: DOMRect, win: Window): number {
  const width = Math.min(rect.right, win.innerWidth) - Math.max(rect.left, 0);
  const height = Math.min(rect.bottom, win.innerHeight) - Math.max(rect.top, 0);
  return width > 0 && height > 0 ? width * height : 0;
}

export function probeBackdropLight(el: HTMLElement): BackdropProbe | null {
  const doc = el.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof doc.elementsFromPoint !== 'function') return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const offscreen =
    rect.bottom <= 0 ||
    rect.top >= win.innerHeight ||
    rect.right <= 0 ||
    rect.left >= win.innerWidth;
  if (offscreen) return null;

  const run = createProbeRun(doc, win);
  const luminances = probeGrid(run, rect, (stack, x, y) => {
    const self = stack.indexOf(el);
    const behind =
      self >= 0
        ? stack.slice(self + 1)
        : stack.filter((node) => node !== el && !el.contains(node));
    return gatherLayers(run, behind, (node) => el.contains(node), { x, y });
  });

  // Empty grid = every point landed on unknowable opaque content (or the
  // element was clamped out of any readable paint) — signal "unreadable"
  // rather than an empty average.
  if (!luminances.length) return { averageLuminance: null, pendingImages: run.pendingImages };
  return { averageLuminance: mean(luminances), pendingImages: run.pendingImages };
}

/**
 * Samples the backdrop under a whole group of glass members.
 *
 * A sample point only counts when it lands on some member. Every member
 * layer (and its subtree) is skipped, so the group reads the page behind it
 * instead of another member's tint — a button stacked on the tab bar cannot
 * feed its own backdrop back into the group. Per-member means are combined
 * by viewport-visible area, so a sparse group (top bar + bottom bar) still
 * resolves. Returns null when no member is currently measurable (offscreen),
 * so the caller keeps its last decision.
 */
export function probeMembersBackdropLight(
  members: readonly HTMLElement[],
): BackdropProbe | null {
  const connected = members.filter((member) => member.isConnected);
  if (!connected.length) return null;
  const doc = connected[0].ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof doc.elementsFromPoint !== 'function') return null;

  const run = createProbeRun(doc, win);
  const isMemberNode = (node: Element) => isWithinMembers(node, connected);
  const samples: { luminance: number; weight: number }[] = [];
  let measurable = false;

  for (const member of connected) {
    const rect = member.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const weight = visibleRectArea(rect, win);
    if (weight <= 0) continue;
    measurable = true;
    const luminances = probeGrid(run, rect, (stack, x, y) => {
      const boundary = stack.findIndex((node) => isMemberNode(node));
      if (boundary < 0) return null; // point not covered by the group
      return gatherLayers(run, stack.slice(boundary + 1), isMemberNode, { x, y });
    });
    if (!luminances.length) continue;
    samples.push({ luminance: mean(luminances), weight });
  }

  if (!measurable) return null; // every member offscreen/zero-size: keep last
  if (!samples.length) return { averageLuminance: null, pendingImages: run.pendingImages };
  return { averageLuminance: aggregateLuminance(samples), pendingImages: run.pendingImages };
}

function pageFallbackColor(doc: Document): Rgba {
  const view = doc.defaultView;
  if (view) {
    for (const node of [doc.body, doc.documentElement]) {
      if (!node) continue;
      const color = parseCssColor(view.getComputedStyle(node).backgroundColor);
      if (color && color.a >= 0.999) return color;
    }
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

export type FirstImage = { kind: 'gradient'; layer: string } | { kind: 'url'; url: string };

/**
 * Extracts the first background-image layer as a gradient spec or a url().
 * Fast path for a leading `url(...)`: data URLs can be megabytes, contain no
 * top-level commas and no parens in their base64 payload, so slicing to the
 * closing paren avoids lowercasing and comma-scanning the whole string.
 */
export function firstImageLayer(backgroundImage: string): FirstImage | null {
  let s = backgroundImage;
  // Trim without copying in the common no-leading/trailing-whitespace case.
  if (s.length > 0 && (s.charCodeAt(0) <= 32 || s.charCodeAt(s.length - 1) <= 32)) {
    s = s.trim();
  }
  if (!s) return null;
  if (s.length < 16 && s.toLowerCase() === 'none') return null;

  if (s.slice(0, 4).toLowerCase() === 'url(') {
    const end = firstUrlLayerEnd(s);
    if (end < 0) return null;
    const url = extractUrl(s.slice(0, end));
    return url ? { kind: 'url', url } : null;
  }

  const first = splitTopLevel(s, ',')
    .map((layer) => layer.trim())
    .find(Boolean);
  if (!first) return null;
  const lower = first.toLowerCase();
  if (lower.startsWith('linear-gradient(') || lower.startsWith('radial-gradient(')) {
    return { kind: 'gradient', layer: first };
  }
  if (lower.startsWith('url(')) {
    const url = extractUrl(first);
    return url ? { kind: 'url', url } : null;
  }
  return null;
}

/** Index just past the closing paren of a leading `url(...)` layer, -1 if malformed. */
function firstUrlLayerEnd(s: string): number {
  const quote = s[4];
  if (quote === '"' || quote === "'") {
    let i = 5;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) break;
      i++;
    }
    if (i >= s.length) return -1;
    let j = i + 1;
    while (j < s.length && s[j] === ' ') j++;
    return s[j] === ')' ? j + 1 : -1;
  }
  const close = s.indexOf(')', 4);
  return close === -1 ? -1 : close + 1;
}

function extractUrl(token: string): string | null {
  const open = token.indexOf('(');
  const close = token.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const raw = token.slice(open + 1, close).trim();
  // Unwrap matched quotes without a regex: the payload can be megabytes.
  const quote = raw[0];
  if ((quote === '"' || quote === "'") && raw.length >= 2 && raw[raw.length - 1] === quote) {
    return raw.slice(1, -1) || null;
  }
  return raw || null;
}

/* ---------------------- image decode & sampling --------------------- */

interface ImageEntry {
  img: HTMLImageElement;
  average: Rgba;
}

type ImageState = ImageEntry | 'pending' | 'failed';

const imageStates = new Map<string, ImageState>();
const imageSettleListeners = new Set<() => void>();

/** Subscribes to image decode settle events; every active hook re-probes. */
export function onImagesSettled(listener: () => void): () => void {
  imageSettleListeners.add(listener);
  return () => {
    imageSettleListeners.delete(listener);
  };
}

function requestImage(url: string): ImageState {
  const existing = imageStates.get(url);
  if (existing) return existing;
  if (typeof window === 'undefined' || typeof Image === 'undefined') return 'failed';
  imageStates.set(url, 'pending');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const average = computeImageAverage(img);
    imageStates.set(url, average ? { img, average } : 'failed');
    notifyImagesSettled();
  };
  img.onerror = () => {
    // CORS-tainted or broken; cached as failed so we never retry-loop.
    imageStates.set(url, 'failed');
    notifyImagesSettled();
  };
  img.src = url;
  return 'pending';
}

function notifyImagesSettled(): void {
  for (const listener of imageSettleListeners) listener();
}

let averageCtx: CanvasRenderingContext2D | null = null;
let pixelCtx: CanvasRenderingContext2D | null = null;

function createContext(size: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.getContext('2d', { willReadFrequently: true });
}

function computeImageAverage(img: HTMLImageElement): Rgba | null {
  if (!averageCtx) averageCtx = createContext(16);
  if (!averageCtx) return null;
  try {
    averageCtx.clearRect(0, 0, 16, 16);
    averageCtx.drawImage(img, 0, 0, 16, 16);
    const data = averageCtx.getImageData(0, 0, 16, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 26) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
    if (!n) return null;
    return { r: r / n, g: g / n, b: b / n, a: 1 };
  } catch {
    return null;
  }
}

/** Samples one image pixel via `cover` + `center` mapping (1×1 canvas read). */
function sampleImagePixel(img: HTMLImageElement, box: Box, point: Point): Rgba | null {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const scale = Math.max(box.width / nw, box.height / nh);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const offsetX = (box.width - nw * scale) / 2;
  const offsetY = (box.height - nh * scale) / 2;
  const sx = Math.min(Math.max((point.x - offsetX) / scale, 0), nw - 1);
  const sy = Math.min(Math.max((point.y - offsetY) / scale, 0), nh - 1);
  if (!pixelCtx) pixelCtx = createContext(1);
  if (!pixelCtx) return null;
  try {
    pixelCtx.clearRect(0, 0, 1, 1);
    pixelCtx.drawImage(img, Math.floor(sx), Math.floor(sy), 1, 1, 0, 0, 1, 1);
    const d = pixelCtx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  } catch {
    return null;
  }
}

/* ---------------------------- utilities ----------------------------- */

function splitTopLevel(input: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === separator && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, v));
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
