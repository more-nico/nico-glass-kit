import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useGlassQuality, type GlassQuality } from './useGlassQuality';
import { useOverLight, type OverLight } from './useOverLight';
import { useGlassFilter, type GlassFilterPreset } from './SvgFilterRegistry';
import { GlassConfigContext } from './GlassProvider';
import { GlassElasticityGroupContext } from './GlassElasticityGroup';
import {
  canAnimateElasticity,
  elasticityTarget,
  resolveElasticity,
  type ElasticityPointer,
} from './elasticityGroup';
import { DEFAULT_OPTICS, resolveOptics, type GlassOptics } from './optics';
import { observeResize } from './observeResize';
import { subscribeSurfacePointer } from './surfacePointer';
import { useGlassDpr } from './useGlassDpr';
import { cancelGlassFrame, requestGlassFrame } from './animationFrame';

/**
 * Prebuilt glyph tile (see `glyphLensMap.ts` / `GlassText`). When present the
 * surface stops being a rounded rectangle: the corner radius is forced to 0,
 * the effect layer is masked to the glyph coverage and the highlight layer to
 * its outline ring, and the displacement map is the preset instead of a
 * generated rectangle map.
 */
export interface GlassGlyphShape {
  /** Identity of the raster (character + font + geometry + optics). */
  key: string;
  /** Coverage mask PNG data URL (glyph fill). */
  maskUrl: string;
  /** Outline ring PNG data URL (highlight mask). */
  ringUrl: string;
  /** Pointer glint's wider inner outline. Defaults to ringUrl for older shapes. */
  glintUrl?: string;
  /** Displacement map PNG data URL. */
  mapUrl: string;
  /** Value for `feDisplacementMap@scale`. */
  scale: number;
  /** Tile box, CSS px. */
  width: number;
  height: number;
}

export interface GlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Rendered element, default `'div'`. */
  as?: ElementType;
  /** Requested quality tier (degrades automatically). */
  quality?: GlassQuality;
  /**
   * Light/dark adaptation. `'auto'` samples the luminance of the backdrop
   * painted beneath this element and picks Light/Dark per element (falls
   * back to prefers-color-scheme when unreadable). `true`/`false` override.
   */
  overLight?: OverLight;
  /** Corner radius px. Default 20. */
  cornerRadius?: number;
  /** Glyph tile: renders the character's own outline as the glass shape. */
  glyphShape?: GlassGlyphShape | null;
  /** Native disabled attribute, used when rendering interactive elements. */
  disabled?: boolean;
  /** Native type attribute (e.g. `'button'` when `as="button"`). */
  type?: string;
  /**
   * Glass material optics: Blur, Saturation, Brightness, Tint, Tint strength,
   * Refraction, Depth, Curvature, Dispersion. Sparse overrides are merged
   * over {@link DEFAULT_OPTICS}.
   */
  optics?: Partial<GlassOptics>;
  /** Mouse elasticity 0..1 (High tier; 0 = rigid). Default 0.2. */
  elasticity?: number;
  /**
   * Extra brightness added on top of the configured optics brightness while
   * the pointer hovers the surface. 0 = off (default). GlassButton defaults
   * this to 0.5.
   */
  hoverBrightnessBoost?: number;
  /**
   * Rim-light strength multiplier (0 = off). The specular glint follows the
   * pointer; without a pointer the rim stays uniform. Default 1.
   */
  highlightIntensity?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/** Glass-related prop subset shared by every ready-made component. */
export type GlassExtras = Pick<
  GlassSurfaceProps,
  'quality' | 'overLight' | 'optics' | 'elasticity' | 'highlightIntensity' | 'hoverBrightnessBoost'
>;

interface SpringState {
  scale: number;
  tx: number;
  ty: number;
  vs: number;
  vtx: number;
  vty: number;
  targetScale: number;
  targetTx: number;
  targetTy: number;
  raf: number;
}

/**
 * Core primitive. Layer stack:
 *   container (radius/shadow) > motion (elastic transform)
 *     > effect (backdrop filter + tint) + highlight (rim light) + content.
 * SSR / first render is pure Low tier; higher tiers enhance after mount.
 */
export function GlassSurface(props: GlassSurfaceProps) {
  const {
    as: Comp = 'div',
    quality,
    overLight,
    cornerRadius = 20,
    glyphShape,
    optics,
    elasticity = 0.2,
    highlightIntensity = 1,
    hoverBrightnessBoost = 0,
    onPointerEnter,
    onPointerLeave,
    className,
    style,
    children,
    ...rest
  } = props;

  const resolvedQuality = useGlassQuality(quality);
  const provider = useContext(GlassConfigContext);
  const elasticityGroup = useContext(GlassElasticityGroupContext);
  const groupRegister = elasticityGroup?.register;
  const resolvedElasticity = resolveElasticity(elasticity, elasticityGroup?.elasticity);
  const containerRef = useRef<HTMLElement | null>(null);
  const light = useOverLight(overLight, containerRef);
  const material = useMemo(() => resolveOptics(DEFAULT_OPTICS, optics), [optics]);

  // Hover brightness boost (interactive components only): on filtered tiers
  // the registry retunes the brightness feFunc slopes in place; the low-tier
  // CSS chain is rewritten directly on the effect layer. Neither path
  // re-renders the component nor rebuilds the filter graph.
  const effectRef = useRef<HTMLDivElement | null>(null);
  const hoverRef = useRef(false);

  const motionRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

  // Element size, rebuilt via ResizeObserver with a ~100ms trailing throttle.
  // NOTE: offsetWidth/Height (border box) — contentRect would exclude padding,
  // but backdrop-filter space is the border box, so the map must cover it all.
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer: number | undefined;
    const unobserve = observeResize(el, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setSize((prev) => {
          const width = el.offsetWidth;
          const height = el.offsetHeight;
          return prev.width === width && prev.height === height
            ? prev
            : { width, height };
        });
      }, 100);
    });
    return () => {
      window.clearTimeout(timer);
      unobserve();
    };
  }, []);

  const dpr = useGlassDpr();

  // A glyph tile is only a glyph when it has a real mask: an empty URL would
  // otherwise render as a rectangular glass block.
  const glyph = glyphShape && glyphShape.maskUrl ? glyphShape : null;
  const hasGlyph = glyph !== null;
  const glyphKey = glyph?.key ?? '';
  const glyphMapUrl = glyph?.mapUrl ?? '';
  const glyphScale = glyph?.scale ?? 0;
  const glyphWidth = glyph?.width ?? 0;
  const glyphHeight = glyph?.height ?? 0;
  const glyphPreset = useMemo<GlassFilterPreset | undefined>(
    () =>
      hasGlyph
        ? {
            key: glyphKey,
            url: glyphMapUrl,
            scale: glyphScale,
            width: glyphWidth,
            height: glyphHeight,
          }
        : undefined,
    [hasGlyph, glyphKey, glyphMapUrl, glyphScale, glyphWidth, glyphHeight],
  );

  // Glyph tiles carry their own raster box, so the tier alone decides whether
  // a filter is needed — no ResizeObserver round trip.
  const needsFilter = hasGlyph
    ? resolvedQuality !== 'low' && glyphWidth >= 2 && glyphHeight >= 2
    : resolvedQuality !== 'low' && size.width >= 2 && size.height >= 2;
  // hoverBrightnessBoost forces a private filter: a shared entry would leak
  // the boosted slopes to every element with identical geometry.
  const { filterId, baseScaleRef, setFilterScale, setFilterBrightness } = useGlassFilter({
    enabled: needsFilter,
    shared: hoverBrightnessBoost <= 0 &&
      (resolvedQuality === 'medium' || resolvedElasticity <= 0 || material.refraction === 0),
    map: {
      width: hasGlyph ? glyphWidth : size.width,
      height: hasGlyph ? glyphHeight : size.height,
      radius: hasGlyph ? 0 : cornerRadius,
      edge: material.depth,
      curvature: material.curvature,
      strength: material.refraction,
      dpr,
      rasterScale: provider.lensMapRasterScale,
    },
    preset: glyphPreset,
    blur: material.blur,
    saturation: material.saturation,
    brightness: material.brightness,
    animateBrightness: hoverBrightnessBoost > 0,
    dispersion: resolvedQuality === 'high' ? material.dispersion : 0,
  });

  const applyHoverBrightness = (active: boolean) => {
    if (hoverBrightnessBoost <= 0) return;
    hoverRef.current = active;
    if (filterId && resolvedQuality !== 'low') {
      setFilterBrightness(
        active ? material.brightness + hoverBrightnessBoost : material.brightness,
      );
      return;
    }
    const effect = effectRef.current;
    if (!effect) return;
    const brightness = active ? material.brightness + hoverBrightnessBoost : material.brightness;
    const chain = `blur(${material.blur}px) saturate(${material.saturation}%) brightness(${brightness})`;
    effect.style.setProperty('backdrop-filter', chain);
    effect.style.setProperty('-webkit-backdrop-filter', chain);
  };

  // If the filter arrives (or the tier upgrades) while the pointer is
  // already over the surface, apply the pending boost to the new graph.
  useEffect(() => {
    if (!filterId || !hoverRef.current || hoverBrightnessBoost <= 0 || resolvedQuality === 'low') {
      return;
    }
    setFilterBrightness(material.brightness + hoverBrightnessBoost);
  }, [filterId, hoverBrightnessBoost, resolvedQuality, material.brightness, setFilterBrightness]);

  // High-tier mouse elasticity: animates ONLY the feDisplacementMap `scale`
  // attributes and the motion wrapper's transform — never rebuilds the map.
  const springRef = useRef<SpringState | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    const motion = motionRef.current;
    if (!el || !motion) return;

    const base = baseScaleRef.current;
    const canAnimate = canAnimateElasticity(resolvedQuality, !!filterId, resolvedElasticity);
    let state: SpringState | null = null;
    let start: () => void = () => {};

    if (canAnimate) {
      state = {
        scale: base,
        tx: 0,
        ty: 0,
        vs: 0,
        vtx: 0,
        vty: 0,
        targetScale: base,
        targetTx: 0,
        targetTy: 0,
        raf: 0,
      };
      springRef.current = state;

      // CSSOM normalizes transform strings (0.00px -> 0px, 0 -> 0px).
      // Comparing our last write avoids dirtying an unchanged transform.
      let lastTransform = '';

      const apply = () => {
        if (!state) return;
        setFilterScale(state.scale);
        const transform = `translate3d(${state.tx.toFixed(2)}px, ${state.ty.toFixed(2)}px, 0)`;
        if (lastTransform !== transform) { motion.style.transform = transform; lastTransform = transform; }
      };

      const tick = () => {
        if (!state) return;
        const k = 180; // stiffness
        const c = 20; // damping
        const dt = 1 / 60;
        let active = false;
        const step = (
          cur: number,
          vel: number,
          target: number,
        ): [number, number] => {
          const acc = k * (target - cur) - c * vel;
          vel += acc * dt;
          cur += vel * dt;
          if (Math.abs(target - cur) > 0.01 || Math.abs(vel) > 0.01) active = true;
          return [cur, vel];
        };
        [state.scale, state.vs] = step(state.scale, state.vs, state.targetScale);
        [state.tx, state.vtx] = step(state.tx, state.vtx, state.targetTx);
        [state.ty, state.vty] = step(state.ty, state.vty, state.targetTy);
        apply();
        state.raf = active ? requestGlassFrame(tick) : 0;
      };

      start = () => {
        if (state && !state.raf) state.raf = requestGlassFrame(tick);
      };
    }

    const setPointer = (pointer: ElasticityPointer | null) => {
      if (!state) return;
      if (!pointer) {
        state.targetScale = base;
        state.targetTx = 0;
        state.targetTy = 0;
        start();
        return;
      }
      const target = elasticityTarget(base, resolvedElasticity, pointer);
      state.targetScale = target.scale;
      state.targetTx = target.tx;
      state.targetTy = target.ty;
      start();
    };

    const unregister = canAnimate
      ? groupRegister ? groupRegister(el, setPointer) : subscribeSurfacePointer(el, setPointer)
      : undefined;

    return () => {
      unregister?.();
      if (state) {
        if (state.raf) cancelGlassFrame(state.raf);
        motion.style.transform = '';
        setFilterScale(base);
        if (springRef.current === state) springRef.current = null;
      }
    };
  }, [resolvedQuality, filterId, resolvedElasticity, groupRegister, baseScaleRef, setFilterScale]);

  // Directional rim light (all tiers, pure CSS vars): the specular glint
  // tracks the pointer; fades back to a uniform rim when the pointer leaves.
  useEffect(() => {
    const el = containerRef.current;
    const hl = highlightRef.current;
    if (!el || !hl || highlightIntensity <= 0) return;

    let raf = 0;
    let opacity = 0;
    let target = 0;
    const setO = (o: number) => {
      const value = o.toFixed(3);
      if (hl.style.getPropertyValue('--ngs-spec-o') !== value) hl.style.setProperty('--ngs-spec-o', value);
    };
    const tick = () => {
      opacity += (target - opacity) * 0.18;
      if (Math.abs(target - opacity) < 0.005) opacity = target;
      setO(opacity);
      raf = opacity === target ? 0 : requestGlassFrame(tick);
    };
    const start = () => {
      if (!raf) raf = requestGlassFrame(tick);
    };
    const unsubscribe = subscribeSurfacePointer(el, pointer => {
      if (pointer) {
        const x = `${pointer.x.toFixed(2)}%`, y = `${pointer.y.toFixed(2)}%`;
        if (hl.style.getPropertyValue('--ngx') !== x) hl.style.setProperty('--ngx', x);
        if (hl.style.getPropertyValue('--ngy') !== y) hl.style.setProperty('--ngy', y);
      }
      target = pointer ? 1 : 0;
      start();
    });
    return () => {
      unsubscribe();
      if (raf) cancelGlassFrame(raf);
      hl.style.removeProperty('--ngs-spec-o');
      hl.style.removeProperty('--ngx');
      hl.style.removeProperty('--ngy');
    };
  }, [highlightIntensity]);

  const lowBackdrop = `blur(${material.blur}px) saturate(${material.saturation}%) brightness(${material.brightness})`;
  const effectStyle: CSSProperties =
    resolvedQuality !== 'low' && filterId
      ? { backdropFilter: `url(#${filterId})` }
      : { backdropFilter: lowBackdrop, WebkitBackdropFilter: lowBackdrop };

  const cls = ['ngs-surface', className].filter(Boolean).join(' ');
  const AnyComp = Comp as ElementType;

  const surfaceStyle = {
    // A glyph has no corners and no box to cast a shadow from.
    borderRadius: glyph ? 0 : cornerRadius,
    '--ngs-hl': highlightIntensity,
    // CSS tokens resolve Auto per surface and still allow component styles
    // (e.g. invalid inputs) to override the public tint variables. Reset the
    // material tint for Auto so nested surfaces do not inherit a parent's dye.
    '--ngs-material-tint': material.tint === DEFAULT_OPTICS.tint ? 'initial' : material.tint,
    '--ngs-material-tint-strength': material.tintStrength,
    ...(glyph
      ? {
          '--ngs-shape-mask': `url("${glyph.maskUrl}")`,
          '--ngs-shape-ring': `url("${glyph.ringUrl}")`,
          '--ngs-shape-glint': `url("${glyph.glintUrl ?? glyph.ringUrl}")`,
        }
      : null),
    ...style,
  } as CSSProperties;

  return (
    <AnyComp
      {...rest}
      ref={containerRef}
      className={cls}
      data-ngs-quality={resolvedQuality}
      data-ngs-light={light ? 'true' : 'false'}
      data-ngs-shape={glyph ? 'glyph' : undefined}
      style={surfaceStyle}
      onPointerEnter={(e: ReactPointerEvent<HTMLElement>) => {
        if (hoverBrightnessBoost > 0) applyHoverBrightness(true);
        onPointerEnter?.(e);
      }}
      onPointerLeave={(e: ReactPointerEvent<HTMLElement>) => {
        if (hoverBrightnessBoost > 0) applyHoverBrightness(false);
        onPointerLeave?.(e);
      }}
    >
      {/* data-ngs-internal marks layers whose style writes are the library's
          own per-frame churn (spring transform, specular vars, tier/hover
          chain swaps); the shared probe scheduler ignores them. */}
      <div className="ngs-motion" data-ngs-internal="style" ref={motionRef}>
        <div className="ngs-effect" data-ngs-internal="style" style={effectStyle} ref={effectRef} />
        <div className="ngs-highlight" data-ngs-internal="style" ref={highlightRef} />
        <div className="ngs-content" data-ngs-internal="style">{children}</div>
      </div>
    </AnyComp>
  );
}
