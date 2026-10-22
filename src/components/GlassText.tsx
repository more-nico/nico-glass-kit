import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import { GlassSurface, type GlassExtras, type GlassGlyphShape } from '../core/GlassSurface';
import { GlassRenderGroup, useGlassRenderGroupEnabled } from '../core/GlassRenderGroup';
import { GlassLightGroup } from '../core/GlassLightGroup';
import { GlassConfigContext } from '../core/GlassProvider';
import { DEFAULT_OPTICS, resolveOptics } from '../core/optics';
import { lensDisplacementScale } from '../core/displacementMap';
import { DISPERSION_SCALE_EPSILON } from '../core/lensFilter';
import { observeResize } from '../core/observeResize';
import { useGlassDpr } from '../core/useGlassDpr';
import {
  DEFAULT_GLYPH_RING_WIDTH,
  clearGlyphRasterCache,
  GLYPH_TILE_PADDING,
  glyphRasterCacheEpoch,
  defaultGlyphRasterScale,
  layoutGlyphs,
  measureTextMetrics,
  prepareGlyphCoverage,
  previewGlyphRaster,
  type GlyphBox,
  type GlyphLayout,
  type GlyphRaster,
  type GlyphRasterOptions,
} from '../core/glyphLensMap';
import {
  cancelGlyphRasterOwner,
  submitGlyphRasterJob,
  type GlyphRasterJobGlyph,
} from '../core/rasterWorkerPool';
import './GlassText.css';

// Measure and rasterise before paint in the browser so text updates never
// briefly reveal the plain-text fallback. Keep the passive effect on the
// server to avoid the useLayoutEffect SSR warning.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface GlassTextProps extends HTMLAttributes<HTMLSpanElement>, GlassExtras {
  /**
   * Single line of text. `\r\n\t` become spaces; control characters and
   * surrogate code units become `?`. Displayable ASCII (0x20–0x7E) is the supported,
   * tested range.
   */
  text: string;
  /** Font size: a number is px, a string goes to CSS (`clamp()`/`vw` work). Default 48. */
  fontSize?: number | string;
  fontFamily?: string;
  fontWeight?: number | string;
  fontStyle?: string;
  /** Letter spacing in px. Applied to the canvas layout and the fallback text. */
  letterSpacing?: number;
  /** Lay digits out at `max(0-9 advance)` so clocks do not jump between frames. */
  tabularNums?: boolean;
}

export interface GlassTextTile {
  box: GlyphBox;
  shape: GlassGlyphShape;
  /**
   * Exact raster key the preview was stretched from. Preview keys append a
   * `fit:` suffix; keeping the source key separate stops suffixes nesting on
   * every font-size frame.
   */
  sourceKey?: string;
}

export interface GlassTextState {
  text: string;
  layout: GlyphLayout;
  tiles: GlassTextTile[];
  /** True when the tiles are resampled from an older exact raster. */
  preview: boolean;
  /** Pixel font size that produced the source masks (exact or inherited). */
  sourceFontSize: number;
  /**
   * Font family/style/weight skeleton. Outlines are only reused within one
   * skeleton; a weight/family change waits for the exact worker result.
   */
  fontKey: string;
}

let nextTextOwnerId = 0;

interface RasterProgress {
  pending: boolean;
  revision: number;
  requestedAt: number;
  settledAt: number | null;
}
type RasterElement = HTMLSpanElement & { __ngsRaster?: RasterProgress };

/**
 * Normalises a single line of text: line breaks and tabs become spaces,
 * control characters and surrogate code units become `?`. Full Unicode
 * shaping is outside this component's supported ASCII contract.
 */
function normaliseText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x0d || code === 0x0a || code === 0x09) {
      out += ' ';
    } else if (code < 0x20 || code === 0x7f || (code >= 0xd800 && code <= 0xdfff)) {
      out += '?';
    } else {
      out += text[i];
    }
  }
  return out;
}

/**
 * True when a worker result is complete and still belongs to the current
 * build. Exported for the focused revision-race regression.
 */
export function isCurrentGlyphCommit(
  deliveredRevision: number,
  currentRevision: number,
  rasterCount: number,
  glyphCount: number,
): boolean {
  return deliveredRevision === currentRevision && rasterCount === glyphCount;
}

function toTiles(layout: GlyphLayout, rasters: GlyphRaster[]): GlassTextTile[] {
  const tiles: GlassTextTile[] = [];
  for (let i = 0; i < layout.glyphs.length; i++) {
    const box = layout.glyphs[i];
    const raster = rasters[i];
    if (!raster) continue;
    tiles.push({
      box,
      shape: {
        key: raster.key,
        maskUrl: raster.maskUrl,
        ringUrl: raster.ringUrl,
        glintUrl: raster.glintUrl,
        mapUrl: raster.mapUrl,
        scale: raster.scale,
        width: raster.width,
        height: raster.height,
      },
    });
  }
  return tiles;
}

function exactState(
  text: string,
  layout: GlyphLayout,
  rasters: GlyphRaster[],
  fontKey: string,
  sourceFontSize: number,
): GlassTextState {
  return {
    text,
    layout,
    tiles: toTiles(layout, rasters),
    preview: false,
    sourceFontSize,
    fontKey,
  };
}

function sameGlyphLayout(a: GlyphLayout, b: GlyphLayout): boolean {
  if (a.width !== b.width || a.height !== b.height || a.baseline !== b.baseline) return false;
  if (a.glyphs.length !== b.glyphs.length) return false;
  for (let i = 0; i < a.glyphs.length; i++) {
    const left = a.glyphs[i];
    const right = b.glyphs[i];
    if (left.index !== right.index || left.char !== right.char ||
      left.x !== right.x || left.y !== right.y ||
      left.width !== right.width || left.height !== right.height ||
      left.penX !== right.penX || left.baseline !== right.baseline) return false;
  }
  return true;
}

/**
 * Font-size drag preview: keep the exact raster images from the previous
 * state but place/stretch each character into the new tile box. The masks use
 * `100% 100%` sizing and the filter preset is re-sized, so the preview stays
 * at the caller's quality tier (never Low) until the worker returns the exact
 * revision. `scale` must come from CSS optics, not from the size ratio.
 */
export function resampleGlyphTiles(
  previous: Pick<GlassTextState, 'tiles'>,
  layout: GlyphLayout,
  scale: number,
): GlassTextTile[] | null {
  const byIndex = new Map<string, GlassTextTile>();
  const byChar = new Map<string, GlassTextTile[]>();
  for (const tile of previous.tiles) {
    byIndex.set(`${tile.box.index}\u0000${tile.box.char}`, tile);
    const group = byChar.get(tile.box.char);
    if (group) group.push(tile);
    else byChar.set(tile.box.char, [tile]);
  }

  const used = new Set<GlassTextTile>();
  const tiles: GlassTextTile[] = [];
  for (const box of layout.glyphs) {
    let source = byIndex.get(`${box.index}\u0000${box.char}`);
    if (!source || used.has(source)) {
      source = (byChar.get(box.char) ?? []).find((tile) => !used.has(tile));
    }
    if (!source) return null;
    used.add(source);

    const sourceKey = source.sourceKey ?? source.shape.key;
    const width = box.width;
    const height = box.height;
    tiles.push({
      box,
      sourceKey,
      shape: {
        ...source.shape,
        // A changed key is what lets the private filter update in place with
        // the new preset box; React's tile key stays index+char.
        key: `${sourceKey}|fit:${width.toFixed(3)}x${height.toFixed(3)}`,
        scale,
        width,
        height,
      },
    });
  }
  return tiles;
}

/**
 * Text whose glyphs are themselves glass: every non-blank character becomes a
 * `GlassSurface` tile whose shape is the character's coverage raster, so the
 * backdrop refracts along the outline, the rim light traces it and the
 * pointer glint slides along it.
 *
 * Canvas is the single source of truth: the tiles, their rasters and the
 * container box all come from one measurement of the rendered font. SSR and
 * the first client frame render plain text in the same font; once the rasters
 * are ready the text is clipped away (it stays in the accessibility tree) and
 * the glass tiles take over.
 *
 * Parameter changes never clear the last exact tiles: they stay on screen as
 * a same-tier high-resolution preview while a worker recomputes the exact
 * optics. When every encoded layer is already cached (for example a
 * refraction-only change) the new exact tiles are assembled synchronously and
 * no worker round trip is needed.
 *
 * `elasticity` is passed through to each GlassSurface tile. When omitted,
 * GlassSurface owns the default, just like every other glass component.
 *
 * Material parameters are passed through unchanged. Only the surface
 * geometry differs from other GlassSurface components.
 */
export function GlassText(props: GlassTextProps) {
  const {
    text,
    fontSize = 48,
    fontFamily,
    fontWeight,
    fontStyle,
    letterSpacing = 0,
    tabularNums = false,
    className,
    style,
    // glass extras
    quality,
    overLight,
    optics,
    elasticity,
    highlightIntensity,
    hoverBrightnessBoost,
    ...rest
  } = props;

  const provider = useContext(GlassConfigContext);
  const batchRendering = useGlassRenderGroupEnabled();
  const material = useMemo(() => resolveOptics(DEFAULT_OPTICS, optics), [optics]);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [state, setState] = useState<GlassTextState | null>(null);
  const lastStateRef = useRef<GlassTextState | null>(null);
  const [probeVersion, setProbeVersion] = useState(0);
  const revisionRef = useRef(0);
  const exactRevisionRef = useRef(0);
  const [owner] = useState(() => `glass-text-${nextTextOwnerId++}`);

  // Keep the last committed state available synchronously: a font-size probe
  // update rebuilds the layout before React has necessarily rendered the
  // previous preview state, and the old shapes are needed for resampling.
  const commitState = (next: GlassTextState | null): void => {
    if (next && !next.preview) exactRevisionRef.current = revisionRef.current;
    lastStateRef.current = next;
    setState(next);
  };

  const normalised = useMemo(() => normaliseText(text), [text]);
  const dpr = useGlassDpr();

  const { depth, curvature, refraction, blur, dispersion } = material;
  const lensMapRasterScale = provider.lensMapRasterScale;

  // Give up this owner's worker slot on unmount; the pool terminates both
  // workers when the last GlassText releases them.
  useEffect(() => () => cancelGlyphRasterOwner(owner), [owner]);

  // Prepare one viewport ahead. Optical changes to text far outside the
  // viewport must not queue expensive exact work ahead of visible text.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    let near = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !near) setProbeVersion(value => value + 1);
      near = entry.isIntersecting;
    }, { rootMargin: '100% 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Canvas measurement + exact rasterisation. Measurement and `fillText` stay
  // synchronous on the main thread (the worker would see a different font);
  // EDT/profile/PNG encoding are submitted to the latest-task worker queue.
  useIsomorphicLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof document === 'undefined') return;
    let cancelled = false;
    let pendingPrepare: ReturnType<typeof setTimeout> | null = null;

    const build = () => {
      if (cancelled) return;
      if (pendingPrepare !== null) {
        clearTimeout(pendingPrepare);
        pendingPrepare = null;
      }
      // Every build owns a revision; worker replies from older revisions are
      // ignored by both the scheduler and this callback.
      const revision = ++revisionRef.current;
      (el as RasterElement).__ngsRaster = { pending: true, revision, requestedAt: performance.now(), settledAt: null };
      const computed = window.getComputedStyle(el);
      const font = [
        computed.fontStyle,
        computed.fontWeight,
        computed.fontSize,
        computed.fontFamily,
      ].join(' ');
      // Size-independent skeleton: outlines may only be resampled when the
      // family/style/weight still produce the same shapes.
      const fontKey = [computed.fontStyle, computed.fontWeight, computed.fontFamily].join(' ');
      const parsedFontSize = Number.parseFloat(computed.fontSize);
      const sourceFontSize = Number.isFinite(parsedFontSize) ? parsedFontSize : 0;
      const metrics = measureTextMetrics(normalised, font, tabularNums);
      if (!metrics) {
        commitState(null);
        return;
      }
      const layout = layoutGlyphs(normalised, metrics.glyphs, letterSpacing, tabularNums, {
        ascent: metrics.ascent,
        descent: metrics.descent,
        // A thin stroke can sample beyond its opposite edge. Keep that
        // backdrop in the tile; the coverage mask clips only the output.
        padding: Math.max(GLYPH_TILE_PADDING, Math.ceil(
          lensDisplacementScale(refraction) / 2 * (1 + dispersion * DISPERSION_SCALE_EPSILON)
          + Math.max(0, blur) * 1.5,
        )),
        digitAdvance: metrics.digitAdvance,
      });
      const rasterScale = defaultGlyphRasterScale(lensMapRasterScale);
      const buildEpoch = glyphRasterCacheEpoch();
      const optionsList: GlyphRasterOptions[] = layout.glyphs.map((box) => ({
        char: box.char,
        font,
        width: box.width,
        height: box.height,
        penX: box.penX,
        baseline: box.baseline,
        depth,
        curvature,
        refraction,
        dpr,
        rasterScale,
        ringWidth: DEFAULT_GLYPH_RING_WIDTH,
      }));

      // Fast path: every encoded layer is cached. Refraction-only changes
      // land here and commit before paint, with no worker round trip.
      const cached = optionsList.map((options) => previewGlyphRaster(options));
      if (cached.every((raster): raster is GlyphRaster => raster !== null)) {
        commitState(exactState(normalised, layout, cached, fontKey, sourceFontSize));
        return;
      }

      if (optionsList.length === 0) {
        cancelGlyphRasterOwner(owner);
        commitState({
          text: normalised,
          layout,
          tiles: [],
          preview: false,
          sourceFontSize,
          fontKey,
        });
        return;
      }

      // Same text, new layout (font-size drag / CSS clamp): immediately
      // resample the previous exact shapes into the new tile boxes. This is
      // the same-tier high-resolution preview; the worker still computes the
      // exact revision below and replaces it atomically.
      const previous = lastStateRef.current;
      if (previous && previous.text === normalised && previous.fontKey === fontKey &&
        !sameGlyphLayout(previous.layout, layout)) {
        const previewTiles = resampleGlyphTiles(
          previous,
          layout,
          // Refraction is a CSS optical strength: it is not rescaled by the
          // font-size ratio.
          lensDisplacementScale(refraction),
        );
        if (previewTiles) {
          commitState({
            text: normalised,
            layout,
            tiles: previewTiles,
            preview: true,
            // Keep the original mask size; stretching inherits the exact
            // source, not the progressively resampled preview.
            sourceFontSize: previous.sourceFontSize || sourceFontSize,
            fontKey,
          });
        }
      }

      // Coverage rasterisation is cached by font/geometry, so optics-only
      // changes skip the canvas readback entirely. Defer it (and the worker
      // submission) until after this frame: the resampled preview must paint
      // before the main thread fills/readbacks every glyph tile. Stale timers
      // bail out on the revision check, so a fast drag only prepares the last
      // frame that reached the event loop.
      const prepareAndSubmit = (): void => {
        if (cancelled || revision !== revisionRef.current) return;
        // A teardown/font clear after this build but before the timer means
        // the deferred coverage belongs to the previous epoch; don't draw it
        // into the new cache.
        if (glyphRasterCacheEpoch() !== buildEpoch) return;
        const jobGlyphs: GlyphRasterJobGlyph[] = [];
        for (const options of optionsList) {
          const prepared = prepareGlyphCoverage(options);
          if (!prepared) {
            // No rasterisable canvas: keep the current readable state rather
            // than flashing an empty tile set.
            return;
          }
          jobGlyphs.push({ options, coverage: prepared.coverage });
        }

        submitGlyphRasterJob(
          owner,
          revision,
          jobGlyphs,
          (deliveredRevision, rasters) => {
            if (cancelled) return;
            if (!isCurrentGlyphCommit(
              deliveredRevision,
              revisionRef.current,
              rasters.length,
              layout.glyphs.length,
            )) return;
            // Atomic exact replacement: one state update swaps every preview
            // tile at once, so no frame mixes two optical geometries.
            commitState(exactState(normalised, layout, rasters, fontKey, sourceFontSize));
          },
          () => {
            // Worker and main-thread fallback both failed; the previous exact
            // tiles (or the accessible plain text) remain readable.
          },
        );
      };
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      if (lastStateRef.current?.text === normalised && lastStateRef.current.fontKey === fontKey &&
        typeof IntersectionObserver !== 'undefined' &&
        (rect.bottom < -viewportHeight || rect.top > viewportHeight * 2)) {
        cancelGlyphRasterOwner(owner);
        return;
      }
      if (typeof setTimeout === 'function') {
        if (pendingPrepare !== null) clearTimeout(pendingPrepare);
        pendingPrepare = setTimeout(() => {
          pendingPrepare = null;
          prepareAndSubmit();
        }, 0);
      } else {
        prepareAndSubmit();
      }
    };

    build();
    const fonts = document.fonts;
    let onFontsLoaded: (() => void) | null = null;
    if (fonts) {
      const rebuildFonts = () => {
        if (cancelled) return;
        clearGlyphRasterCache();
        build();
      };
      if (fonts.status === 'loading') void fonts.ready.then(rebuildFonts);
      onFontsLoaded = rebuildFonts;
      fonts.addEventListener('loadingdone', onFontsLoaded);
    }
    return () => {
      cancelled = true;
      if (pendingPrepare !== null) clearTimeout(pendingPrepare);
      if (fonts && onFontsLoaded) fonts.removeEventListener('loadingdone', onFontsLoaded);
    };
  }, [
    normalised,
    letterSpacing,
    tabularNums,
    depth,
    curvature,
    refraction,
    blur,
    dispersion,
    dpr,
    lensMapRasterScale,
    probeVersion,
    fontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    className,
    style?.font,
    style?.fontSize,
    style?.fontFamily,
    style?.fontWeight,
    style?.fontStyle,
    owner,
  ]);

  // Non-DOM bookkeeping lets the benchmark measure exact completion without
  // generating mutation records that would re-trigger lighting probes.
  useIsomorphicLayoutEffect(() => {
    const el = rootRef.current as RasterElement | null;
    if (!el?.__ngsRaster || !state || state.preview || state !== lastStateRef.current ||
      exactRevisionRef.current !== revisionRef.current) return;
    el.__ngsRaster.pending = false;
    el.__ngsRaster.settledAt = performance.now();
  }, [state]);

  // Font-size changes coming from CSS (media/container queries, `clamp()`)
  // resize the probe, which triggers a re-measure; the container itself is
  // already locked to the previous canvas layout.
  useEffect(() => {
    const probe = probeRef.current;
    if (!probe || typeof ResizeObserver === 'undefined') return;
    return observeResize(probe, () => setProbeVersion((version) => version + 1));
  }, []);

  const ready = state !== null && state.text === normalised;
  const rootStyle: CSSProperties = {
    fontSize: typeof fontSize === 'number' ? `${fontSize}px` : fontSize,
    fontFamily,
    fontWeight,
    fontStyle,
    letterSpacing: letterSpacing ? `${letterSpacing}px` : undefined,
    ...(tabularNums ? { fontVariantNumeric: 'tabular-nums' } : null),
    ...(ready
      ? {
          width: state.layout.width,
          height: state.layout.height,
          lineHeight: `${state.layout.height}px`,
        }
      : null),
    ...style,
  };

  const cls = ['ngs-text', className].filter(Boolean).join(' ');

  return (
    <span
      {...rest}
      ref={rootRef}
      className={cls}
      style={rootStyle}
      data-ngs-text-ready={ready ? '' : undefined}
      data-ngs-text-preview={ready && state.preview ? '' : undefined}
    >
      {/* Stays in flow (so the container baseline is stable) and in the
          accessibility tree; clipped away once the glass is ready. */}
      <span
        className="ngs-text-fallback"
        style={letterSpacing ? { marginInlineEnd: -letterSpacing } : undefined}
      >
        {normalised}
      </span>
      {ready ? (
        <GlassLightGroup>
          <GlassRenderGroup as="span" enabled={batchRendering} style={{ position: 'absolute', inset: 0 }}>
          {state.tiles.map((tile) => (
            <GlassSurface
              // Stable per-character identity: parameter updates must not
              // remount the glass tiles (remounting is the low-tier flash).
              key={`${tile.box.index}-${tile.box.char}`}
              as="span"
              className="ngs-text-tile"
              aria-hidden="true"
              cornerRadius={0}
              glyphShape={tile.shape}
              style={{
                left: tile.box.x,
                top: tile.box.y,
                width: tile.box.width,
                height: tile.box.height,
              }}
              quality={quality}
              overLight={overLight}
              optics={material}
              elasticity={elasticity}
              highlightIntensity={highlightIntensity}
              hoverBrightnessBoost={hoverBrightnessBoost}
            />
          ))}
          </GlassRenderGroup>
        </GlassLightGroup>
      ) : null}
      <span className="ngs-text-probe" aria-hidden="true" ref={probeRef} />
    </span>
  );
}
