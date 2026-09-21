import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import { GlassSurface, type GlassExtras, type GlassGlyphShape } from '../core/GlassSurface';
import { GlassLightGroup } from '../core/GlassLightGroup';
import { GlassConfigContext } from '../core/GlassProvider';
import { DEFAULT_OPTICS, resolveOptics } from '../core/optics';
import { lensDisplacementScale } from '../core/displacementMap';
import { DISPERSION_SCALE_EPSILON } from '../core/lensFilter';
import {
  DEFAULT_GLYPH_RING_WIDTH,
  clearGlyphRasterCache,
  GLYPH_TILE_PADDING,
  defaultGlyphRasterScale,
  generateGlyphRaster,
  layoutGlyphs,
  measureTextMetrics,
  type GlyphBox,
  type GlyphLayout,
} from '../core/glyphLensMap';
import './GlassText.css';

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

interface GlassTextTile {
  box: GlyphBox;
  shape: GlassGlyphShape;
}

interface GlassTextState {
  text: string;
  layout: GlyphLayout;
  tiles: GlassTextTile[];
}

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
 * `elasticity` defaults to 0: a per-tile spring would let the glyphs drift
 * apart. It is still honoured when set explicitly.
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
    elasticity = 0,
    highlightIntensity,
    hoverBrightnessBoost,
    ...rest
  } = props;

  const provider = useContext(GlassConfigContext);
  const material = useMemo(() => resolveOptics(DEFAULT_OPTICS, optics), [optics]);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [state, setState] = useState<GlassTextState | null>(null);
  const [probeVersion, setProbeVersion] = useState(0);

  const normalised = useMemo(() => normaliseText(text), [text]);
  const [dpr, setDpr] = useState(
    () => (typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)),
  );
  useEffect(() => {
    const updateDpr = () => setDpr(Math.min(window.devicePixelRatio || 1, 2));
    window.addEventListener('resize', updateDpr);
    return () => window.removeEventListener('resize', updateDpr);
  }, []);

  const { depth, curvature, refraction, blur, dispersion } = material;
  const lensMapRasterScale = provider.lensMapRasterScale;

  // Canvas measurement + rasterisation. Re-runs when the font, the text, the
  // optics or the resolved font size (probe) change, and after every font load.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof document === 'undefined') return;
    let cancelled = false;

    const build = () => {
      if (cancelled) return;
      const computed = window.getComputedStyle(el);
      const font = [
        computed.fontStyle,
        computed.fontWeight,
        computed.fontSize,
        computed.fontFamily,
      ].join(' ');
      const metrics = measureTextMetrics(normalised, font, tabularNums);
      if (!metrics) {
        setState(null);
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
      const tiles: GlassTextTile[] = [];
      for (const box of layout.glyphs) {
        const raster = generateGlyphRaster({
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
        });
        if (!raster) {
          setState(null);
          return;
        }
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
      setState({ text: normalised, layout, tiles });
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
  ]);

  // Font-size changes coming from CSS (media/container queries, `clamp()`)
  // resize the probe, which triggers a re-measure; the container itself is
  // already locked to the previous canvas layout.
  useEffect(() => {
    const probe = probeRef.current;
    if (!probe || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setProbeVersion((version) => version + 1));
    ro.observe(probe);
    return () => ro.disconnect();
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
          {state.tiles.map((tile) => (
            <GlassSurface
              key={`${tile.box.index}-${tile.shape.key}`}
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
        </GlassLightGroup>
      ) : null}
      <span className="ngs-text-probe" aria-hidden="true" ref={probeRef} />
    </span>
  );
}
