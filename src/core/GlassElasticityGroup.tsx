import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { mapPointerToElasticityGroup, unionElasticityRects, type ElasticityPointer } from './elasticityGroup';

export type ElasticityPointerHandler = (pointer: ElasticityPointer | null) => void;

export interface GlassElasticityGroupContextValue {
  elasticity: number;
  register: (element: HTMLElement, handler: ElasticityPointerHandler) => () => void;
}

export const GlassElasticityGroupContext =
  createContext<GlassElasticityGroupContextValue | null>(null);

export interface GlassElasticityGroupProps {
  children?: ReactNode;
  /** Shared pointer elasticity (0–1) for every surface in this group. Default 0.2. */
  elasticity?: number;
}

/**
 * Drives every descendant glass surface from one pointer field spanning the
 * union of their viewport rectangles. Renders no DOM and is independent of
 * `GlassLightGroup`.
 */
export function GlassElasticityGroup({ children, elasticity = 0.2 }: GlassElasticityGroupProps) {
  const membersRef = useRef(new Map<HTMLElement, ElasticityPointerHandler>());
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  const refreshRef = useRef<() => void>(() => undefined);

  const register = useCallback((element: HTMLElement, handler: ElasticityPointerHandler) => {
    membersRef.current.set(element, handler);
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => refreshRef.current());
      resizeObserver.observe(element);
    }
    refreshRef.current();

    return () => {
      membersRef.current.delete(element);
      resizeObserver?.disconnect();
      refreshRef.current();
    };
  }, []);

  useEffect(() => {
    const reset = () => {
      lastPointerRef.current = null;
      if (!activeRef.current) return;
      activeRef.current = false;
      for (const [element, handler] of membersRef.current) {
        if (element.isConnected) handler(null);
      }
    };

    const refresh = () => {
      const pointer = lastPointerRef.current;
      if (!pointer) return;

      const members = [...membersRef.current].filter(([element]) => element.isConnected);
      const bounds = unionElasticityRects(
        members.map(([element]) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        }),
      );
      const mapped = bounds
        ? mapPointerToElasticityGroup(bounds, pointer.x, pointer.y)
        : null;

      if (!mapped) {
        reset();
        return;
      }

      activeRef.current = true;
      for (const [, handler] of members) handler(mapped);
    };

    refreshRef.current = refresh;
    const onPointerMove = (event: PointerEvent) => {
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      refresh();
    };
    const onPointerCancel = () => reset();
    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) reset();
    };
    const onWindowBlur = () => reset();
    const onLayoutChange = () => refresh();

    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('pointerout', onPointerOut);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', onLayoutChange);
    window.addEventListener('scroll', onLayoutChange, true);

    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onLayoutChange);
      window.removeEventListener('scroll', onLayoutChange, true);
      refreshRef.current = () => undefined;
      reset();
    };
  }, []);

  const value = useMemo(() => ({ elasticity, register }), [elasticity, register]);
  return (
    <GlassElasticityGroupContext.Provider value={value}>
      {children}
    </GlassElasticityGroupContext.Provider>
  );
}
