/**
 * SVG filter registry: a hidden `<svg>` mounted by {@link GlassProvider} that
 * owns every `<filter>` node used by glass surfaces. Filters are keyed so
 * identical geometry/params share one node (Medium tier), while High tier
 * instances get private entries they can animate freely.
 *
 * The graph is assembled from `lensFilter.ts` pass descriptors (ported from
 * the nicoGlassKit reference): feImage(map) → in-graph blur → saturate →
 * brightness → displacement (single, or three RGB-separated passes for
 * chromatic dispersion blended back with screen).
 *
 * `setScale` rescales every `feDisplacementMap` multiplicatively from the
 * base scale — cheap per-frame animation without React re-renders and
 * *without* ever rebuilding the displacement map.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { generateLensMap, lensMapCacheKey, type LensMapOptions } from './displacementMap';
import {
  createLensFilter,
  LENS_FILTER_COLOR_INTERPOLATION,
  lensChannelMatrix,
  lensPassScaleRatios,
  lensRegionPercent,
  lensSaturationMatrix,
  type LensFilterPass,
} from './lensFilter';

export interface GlassFilterSpec {
  key: string;
  /** feImage bitmap size (element box, CSS px). */
  width: number;
  height: number;
  mapUrl: string;
  /** Base feDisplacementMap scale (px). */
  scale: number;
  /** Backdrop blur radius in px, sigma = blur/2 inside the graph. */
  blur: number;
  /** Percent (100 = unchanged). */
  saturation: number;
  /** Brightness multiplier (1 = unchanged). */
  brightness: number;
  /** Emit a (possibly identity) brightness pass that setBrightness can retune. */
  animateBrightness: boolean;
  /** Chromatic dispersion 0–1. */
  dispersion: number;
}

interface RegistryEntry {
  id: string;
  mapUrl: string;
  width: number;
  height: number;
  passes: LensFilterPass[];
  ratios: number[];
  region: { x: string; y: string; width: string; height: string };
  count: number;
}

interface RegistryApi {
  acquire(spec: GlassFilterSpec): string;
  release(id: string): void;
  setScale(id: string, base: number): void;
  setBrightness(id: string, amount: number): void;
}

export const GlassFilterRegistryContext = createContext<RegistryApi | null>(null);

export function SvgFilterRegistry({ children }: { children?: ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [entries, setEntries] = useState<Map<string, RegistryEntry>>(new Map());
  const idToKey = useRef(new Map<string, string>());

  // Mutable filter-graph nodes, indexed by filter id: the elasticity spring
  // retunes the feDisplacementMap scales and hover boosts retune the
  // brightness feFunc slopes in place — no React renders, no rebuilds.
  interface FilterNodes {
    scale: Map<number, { node: SVGFEDisplacementMapElement; ratio: number }>;
    brightnessR: SVGComponentTransferFunctionElement | null;
    brightnessG: SVGComponentTransferFunctionElement | null;
    brightnessB: SVGComponentTransferFunctionElement | null;
  }
  const nodesRef = useRef(new Map<string, FilterNodes>());

  const filterNodes = (id: string): FilterNodes => {
    let nodes = nodesRef.current.get(id);
    if (!nodes) {
      nodes = { scale: new Map(), brightnessR: null, brightnessG: null, brightnessB: null };
      nodesRef.current.set(id, nodes);
    }
    return nodes;
  };

  const idFor = useCallback(
    (key: string) => {
      let h = 5381;
      for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
      return `ngs${uid}-${(h >>> 0).toString(36)}`;
    },
    [uid],
  );

  const acquire = useCallback(
    (spec: GlassFilterSpec) => {
      const id = idFor(spec.key);
      idToKey.current.set(id, spec.key);
      setEntries((prev) => {
        const next = new Map(prev);
        const existing = next.get(spec.key);
        if (existing) {
          next.set(spec.key, { ...existing, count: existing.count + 1 });
        } else {
          const descriptor = createLensFilter({
            mapUrl: spec.mapUrl,
            width: spec.width,
            height: spec.height,
            scale: spec.scale,
            blur: spec.blur,
            saturation: spec.saturation,
            brightness: spec.brightness,
            animateBrightness: spec.animateBrightness,
            dispersion: spec.dispersion,
          });
          next.set(spec.key, {
            id,
            mapUrl: spec.mapUrl,
            width: spec.width,
            height: spec.height,
            passes: descriptor.passes,
            ratios: lensPassScaleRatios(descriptor.passes, spec.scale),
            region: lensRegionPercent(spec.width, spec.height, descriptor.regionPaddingPx),
            count: 1,
          });
        }
        return next;
      });
      return id;
    },
    [idFor],
  );

  const release = useCallback((id: string) => {
    const key = idToKey.current.get(id);
    if (!key) return;
    setEntries((prev) => {
      const existing = prev.get(key);
      if (!existing) return prev;
      const next = new Map(prev);
      if (existing.count <= 1) {
        next.delete(key);
        idToKey.current.delete(id);
      } else {
        next.set(key, { ...existing, count: existing.count - 1 });
      }
      return next;
    });
  }, []);

  const setScale = useCallback((id: string, base: number) => {
    const nodes = nodesRef.current.get(id);
    if (!nodes) return;
    for (const { node, ratio } of nodes.scale.values()) {
      node.setAttribute('scale', String(Math.max(0, base * ratio)));
    }
  }, []);

  const setBrightness = useCallback((id: string, amount: number) => {
    const nodes = nodesRef.current.get(id);
    if (!nodes) return;
    const slope = String(Math.max(0, amount));
    nodes.brightnessR?.setAttribute('slope', slope);
    nodes.brightnessG?.setAttribute('slope', slope);
    nodes.brightnessB?.setAttribute('slope', slope);
  }, []);

  const api = useMemo<RegistryApi>(
    () => ({ acquire, release, setScale, setBrightness }),
    [acquire, release, setScale, setBrightness],
  );

  const scaleRef =
    (id: string, slot: number, ratio: number) =>
    (node: SVGFEDisplacementMapElement | null) => {
      if (node) {
        filterNodes(id).scale.set(slot, { node, ratio });
      } else {
        nodesRef.current.get(id)?.scale.delete(slot);
      }
    };

  const brightnessRef =
    (id: string, channel: 'r' | 'g' | 'b') =>
    (node: SVGComponentTransferFunctionElement | null) => {
      const nodes = node ? filterNodes(id) : nodesRef.current.get(id);
      if (!nodes) return;
      if (channel === 'r') nodes.brightnessR = node;
      else if (channel === 'g') nodes.brightnessG = node;
      else nodes.brightnessB = node;
    };

  const renderPass = (
    id: string,
    ratios: number[],
    pass: LensFilterPass,
    index: number,
    nextSlot: () => number,
  ) => {
    switch (pass.type) {
      case 'displacement': {
        const slot = nextSlot();
        return (
          <feDisplacementMap
            key={index}
            ref={scaleRef(id, slot, ratios[slot] ?? 1)}
            in={pass.input}
            in2={pass.map}
            scale={pass.scale}
            xChannelSelector="R"
            yChannelSelector="G"
            result={pass.result}
          />
        );
      }
      case 'channel':
        return (
          <feColorMatrix
            key={index}
            in={pass.input}
            type="matrix"
            values={lensChannelMatrix(pass.channel)}
            result={pass.result}
          />
        );
      case 'blend':
        return (
          <feBlend
            key={index}
            in={pass.input}
            in2={pass.input2}
            mode={pass.mode}
            result={pass.result}
          />
        );
      case 'blur':
        return (
          <feGaussianBlur
            key={index}
            in={pass.input}
            stdDeviation={pass.sigma}
            result={pass.result}
          />
        );
      case 'saturate':
        return (
          <feColorMatrix
            key={index}
            in={pass.input}
            type="matrix"
            values={lensSaturationMatrix(pass.amount)}
            result={pass.result}
          />
        );
      case 'brightness':
        return (
          <feComponentTransfer key={index} in={pass.input} result={pass.result}>
            <feFuncR
              type="linear"
              slope={pass.amount}
              intercept={0}
              ref={brightnessRef(id, 'r')}
            />
            <feFuncG
              type="linear"
              slope={pass.amount}
              intercept={0}
              ref={brightnessRef(id, 'g')}
            />
            <feFuncB
              type="linear"
              slope={pass.amount}
              intercept={0}
              ref={brightnessRef(id, 'b')}
            />
          </feComponentTransfer>
        );
    }
  };

  return (
    <GlassFilterRegistryContext.Provider value={api}>
      {children}
      <svg
        aria-hidden="true"
        focusable="false"
        data-ngs-internal="all"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        colorInterpolationFilters={LENS_FILTER_COLOR_INTERPOLATION}
      >
        <defs>
          {[...entries.values()].map(({ id, mapUrl, width, height, passes, ratios, region }) => {
            let slot = 0;
            const nextSlot = (): number => slot++;
            return (
              <filter
                key={id}
                id={id}
                x={region.x}
                y={region.y}
                width={region.width}
                height={region.height}
                colorInterpolationFilters={LENS_FILTER_COLOR_INTERPOLATION}
              >
                {/*
                  * The displacement map. preserveAspectRatio=none stretches the
                  * bitmap over the element box; neutral interior pixels keep the
                  * flat middle undistorted.
                  */}
                <feImage
                  href={mapUrl}
                  x="0"
                  y="0"
                  width={width}
                  height={height}
                  preserveAspectRatio="none"
                  result="map"
                />
                {passes.map((pass, index) => renderPass(id, ratios, pass, index, nextSlot))}
              </filter>
            );
          })}
        </defs>
      </svg>
    </GlassFilterRegistryContext.Provider>
  );
}

export interface UseGlassFilterOptions {
  /** Whether a filter is needed at all (quality tier + known size). */
  enabled: boolean;
  /** true = share filter across identical geometry (Medium); false = private (High). */
  shared: boolean;
  /** Lens geometry + material params (optics-resolved). */
  map: Omit<LensMapOptions, 'skipDataUrl'>;
  /** Backdrop blur radius in px applied inside the graph (sigma = blur/2). */
  blur: number;
  /** Percent. */
  saturation: number;
  /** Brightness multiplier. */
  brightness: number;
  /** Keep a retunable brightness pass so hover boosts never rebuild the graph. */
  animateBrightness?: boolean;
  /** Chromatic dispersion 0–1. */
  dispersion: number;
}

export interface UseGlassFilterResult {
  filterId: string | null;
  baseScaleRef: MutableRefObject<number>;
  /** Direct DOM mutation of the feDisplacementMap scales, safe per frame. */
  setFilterScale: (base: number) => void;
  /** Direct DOM mutation of the brightness feFunc slopes, safe per frame. */
  setFilterBrightness: (amount: number) => void;
}

export function useGlassFilter(opts: UseGlassFilterOptions): UseGlassFilterResult {
  const registry = useContext(GlassFilterRegistryContext);
  const instanceKey = useId();
  const [filterId, setFilterId] = useState<string | null>(null);
  const baseScaleRef = useRef(0);
  const filterIdRef = useRef<string | null>(null);
  filterIdRef.current = filterId;

  const { enabled, shared, map, blur, saturation, brightness, animateBrightness, dispersion } = opts;
  const { width, height, radius, edge, curvature, strength, dpr, rasterScale } = map;

  useEffect(() => {
    if (!registry || !enabled || width < 2 || height < 2) {
      setFilterId(null);
      return;
    }
    let id: string | null = null;
    try {
      const generated = generateLensMap({ width, height, radius, edge, curvature, strength, dpr, rasterScale });
      if (!generated.dataUrl) throw new Error('nico-glass-kit: lens map rasterisation unavailable');
      const baseScale = generated.maxScale;
      baseScaleRef.current = baseScale;
      const key = [
        lensMapCacheKey({ width, height, radius, edge, curvature, strength, dpr, rasterScale }),
        `b${blur}`,
        `sat${saturation}`,
        `br${brightness}`,
        `ab${animateBrightness ? 1 : 0}`,
        `x${dispersion}`,
        `sc${Math.round(baseScale * 100)}`,
        shared ? 'shared' : instanceKey,
      ].join('|');
      id = registry.acquire({
        key,
        width,
        height,
        mapUrl: generated.dataUrl,
        scale: baseScale,
        blur,
        saturation,
        brightness,
        animateBrightness: animateBrightness ?? false,
        dispersion,
      });
      setFilterId(id);
    } catch {
      setFilterId(null);
      return;
    }
    return () => {
      if (id) registry.release(id);
    };
  }, [
    registry,
    enabled,
    shared,
    width,
    height,
    radius,
    edge,
    curvature,
    strength,
    dpr,
    rasterScale,
    blur,
    saturation,
    brightness,
    animateBrightness,
    dispersion,
    instanceKey,
  ]);

  const setFilterScale = useCallback(
    (base: number) => {
      if (registry && filterIdRef.current) registry.setScale(filterIdRef.current, base);
    },
    [registry],
  );

  const setFilterBrightness = useCallback(
    (amount: number) => {
      if (registry && filterIdRef.current) registry.setBrightness(filterIdRef.current, amount);
    },
    [registry],
  );

  return { filterId, baseScaleRef, setFilterScale, setFilterBrightness };
}
