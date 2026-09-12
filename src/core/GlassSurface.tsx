import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { useGlassQuality, type GlassQuality } from './useGlassQuality';
import { useOverLight, type OverLight } from './useOverLight';
import { useGlassFilter } from './SvgFilterRegistry';
import type { SurfaceProfileFn, SurfaceProfileName } from './surfaceFunctions';

export interface GlassSurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Rendered element, default `'div'`. */
  as?: ElementType;
  /** Requested quality tier (degrades automatically). */
  quality?: GlassQuality;
  /** Light/dark adaptation; `'auto'` follows prefers-color-scheme. */
  overLight?: OverLight;
  /** Corner radius px. Default 20. */
  cornerRadius?: number;
  /** Curved-edge width px (default derived from radius/size). */
  bezelWidth?: number;
  /** Surface profile for refraction, default `'squircle'`. */
  profile?: SurfaceProfileName | SurfaceProfileFn;
  /** Backdrop blur px (Low tier; filter tiers use blur/3 Gaussian). Default 12. */
  blur?: number;
  /** Backdrop saturation percent. Default 140. */
  saturation?: number;
  /** Displacement strength; 70 = physically accurate. Default 70. */
  displacementScale?: number;
  /** Chromatic aberration px (High tier). Default 2. */
  aberrationIntensity?: number;
  /** Mouse elasticity 0..1 (High tier; 0 = rigid). Default 0.15. */
  elasticity?: number;
  /**
   * Rim-light strength multiplier (0 = off). The specular glint follows the
   * pointer; without a pointer the rim stays uniform. Default 1.
   */
  highlightIntensity?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

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
    bezelWidth,
    profile,
    blur = 12,
    saturation = 140,
    displacementScale = 70,
    aberrationIntensity = 2,
    elasticity = 0.15,
    highlightIntensity = 1,
    className,
    style,
    children,
    ...rest
  } = props;

  const resolvedQuality = useGlassQuality(quality);
  const light = useOverLight(overLight);

  const containerRef = useRef<HTMLElement | null>(null);
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

  const needsFilter =
    resolvedQuality !== 'low' && size.width >= 2 && size.height >= 2;
  const { filterId, baseScaleRef, setFilterScale } = useGlassFilter({
    enabled: needsFilter,
    shared: resolvedQuality === 'medium',
    width: size.width,
    height: size.height,
    radius: cornerRadius,
    bezel: bezelWidth,
    profile,
    displacementScale,
    blur,
    saturation,
    aberration: resolvedQuality === 'high' ? aberrationIntensity : 0,
  });

  // High-tier mouse elasticity: animates ONLY the feDisplacementMap `scale`
  // attribute and the motion wrapper's transform — never rebuilds the map.
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

  const lowBackdrop = `blur(${blur}px) saturate(${saturation}%)`;
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
    >
      <div className="ngs-motion" ref={motionRef}>
        <div className="ngs-effect" style={effectStyle} />
        <div className="ngs-highlight" ref={highlightRef} />
        <div className="ngs-content">{children}</div>
      </div>
    </AnyComp>
  );
}
