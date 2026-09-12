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
import { useGlassFilter } from './SvgFilterRegistry';
import { GlassConfigContext } from './GlassProvider';
import { DEFAULT_OPTICS, resolveOptics, type GlassOptics } from './optics';

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
    const ro = new ResizeObserver(() => {
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
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  const dpr = useMemo(
    () => (typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2)),
    [],
  );

  const needsFilter =
    resolvedQuality !== 'low' && size.width >= 2 && size.height >= 2;
  // hoverBrightnessBoost forces a private filter: a shared entry would leak
  // the boosted slopes to every element with identical geometry.
  const { filterId, baseScaleRef, setFilterScale, setFilterBrightness } = useGlassFilter({
    enabled: needsFilter,
    shared: resolvedQuality === 'medium' && hoverBrightnessBoost <= 0,
    map: {
      width: size.width,
      height: size.height,
      radius: cornerRadius,
      edge: Math.max(material.depth, 0.5),
      curvature: material.curvature,
      strength: material.refraction,
      dpr,
      rasterScale: provider.lensMapRasterScale,
    },
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
    if (resolvedQuality !== 'high' || !filterId || elasticity <= 0) return;

    const base = baseScaleRef.current;
    const state: SpringState = {
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

    const apply = () => {
      setFilterScale(state.scale);
      motion.style.transform = `translate3d(${state.tx.toFixed(2)}px, ${state.ty.toFixed(2)}px, 0)`;
    };

    const tick = () => {
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
      state.raf = active ? requestAnimationFrame(tick) : 0;
    };

    const start = () => {
      if (!state.raf) state.raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = (e.clientX - (rect.left + rect.width / 2)) / rect.width; // -0.5..0.5
      const ny = (e.clientY - (rect.top + rect.height / 2)) / rect.height;
      const dist = Math.min(1, Math.hypot(nx, ny) * 2);
      state.targetScale = base * (1 + elasticity * 0.5 * (1 - dist * 0.6));
      state.targetTx = nx * elasticity * 24;
      state.targetTy = ny * elasticity * 24;
      start();
    };
    const onLeave = () => {
      state.targetScale = base;
      state.targetTx = 0;
      state.targetTy = 0;
      start();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointercancel', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointercancel', onLeave);
      if (state.raf) cancelAnimationFrame(state.raf);
      motion.style.transform = '';
      setFilterScale(base);
      springRef.current = null;
    };
  }, [resolvedQuality, filterId, elasticity, baseScaleRef, setFilterScale]);

  // Directional rim light (all tiers, pure CSS vars): the specular glint
  // tracks the pointer; fades back to a uniform rim when the pointer leaves.
  useEffect(() => {
    const el = containerRef.current;
    const hl = highlightRef.current;
    if (!el || !hl || highlightIntensity <= 0) return;

    let raf = 0;
    let opacity = 0;
    let target = 0;
    const setO = (o: number) => hl.style.setProperty('--ngs-spec-o', o.toFixed(3));
    const tick = () => {
      opacity += (target - opacity) * 0.18;
      if (Math.abs(target - opacity) < 0.005) opacity = target;
      setO(opacity);
      raf = opacity === target ? 0 : requestAnimationFrame(tick);
    };
    const start = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      hl.style.setProperty(
        '--ngx',
        `${(((e.clientX - rect.left) / rect.width) * 100).toFixed(2)}%`,
      );
      hl.style.setProperty(
        '--ngy',
        `${(((e.clientY - rect.top) / rect.height) * 100).toFixed(2)}%`,
      );
      target = 1;
      start();
    };
    const onLeave = () => {
      target = 0;
      start();
    };

    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointercancel', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointercancel', onLeave);
      if (raf) cancelAnimationFrame(raf);
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
    borderRadius: cornerRadius,
    '--ngs-hl': highlightIntensity,
    ...style,
  } as CSSProperties;

  return (
    <AnyComp
      {...rest}
      ref={containerRef}
      className={cls}
      data-ngs-quality={resolvedQuality}
      data-ngs-light={light ? 'true' : 'false'}
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
