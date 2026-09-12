/**
 * SVG filter registry: a hidden `<svg>` mounted by {@link GlassProvider} that
 * owns every `<filter>` node used by glass surfaces. Filters are keyed so
 * identical geometry/params share one node (Medium tier), while High tier
 * instances get private entries they can animate freely.
 *
 * `setScale` mutates the `feDisplacementMap` `scale` attribute directly —
 * cheap per-frame animation without React re-renders and *without* ever
 * rebuilding the displacement map.
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
import {
  displacementMapCacheKey,
  getDisplacementMap,
} from './displacementMap';
import type { SurfaceProfileFn, SurfaceProfileName } from './surfaceFunctions';

export interface GlassFilterSpec {
  key: string;
  /** feImage placement (map overscan offset, ≤ 0). */
  offsetX: number;
  offsetY: number;
  /** feImage bitmap size (element box + overscan). */
  width: number;
  height: number;
  mapUrl: string;
  /** Base feDisplacementMap scale (px). */
  scale: number;
  /** feGaussianBlur stdDeviation. */
  blur: number;
  /** Percent (100 = unchanged). */
  saturation: number;
  /** Chromatic aberration: +/- scale separation between R and B channels. */
  aberration: number;
}

interface RegistryEntry {
  id: string;
  spec: GlassFilterSpec;
  count: number;
}

interface RegistryApi {
  acquire(spec: GlassFilterSpec): string;
  release(id: string): void;
  setScale(id: string, base: number): void;
}

export const GlassFilterRegistryContext = createContext<RegistryApi | null>(null);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// Channel isolation matrices (keep alpha, zero the other two channels).
const RED_ONLY = '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0';
const GREEN_ONLY = '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0';
const BLUE_ONLY = '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0';

export function SvgFilterRegistry({ children }: { children?: ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [entries, setEntries] = useState<Map<string, RegistryEntry>>(new Map());
  const idToKey = useRef(new Map<string, string>());
  const scaleNodes = useRef(
    new Map<string, { node: SVGFEDisplacementMapElement; delta: number }>(),
  );

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
        if (existing) next.set(spec.key, { ...existing, count: existing.count + 1 });
        else next.set(spec.key, { id, spec, count: 1 });
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
    scaleNodes.current.forEach(({ node, delta }, slotId) => {
      if (slotId.startsWith(`${id}:`)) {
        node.setAttribute('scale', String(Math.max(0, base + delta)));
      }
    });
  }, []);

  const api = useMemo<RegistryApi>(() => ({ acquire, release, setScale }), [acquire, release, setScale]);

  const scaleRef =
    (id: string, slot: number, delta: number) =>
    (node: SVGFEDisplacementMapElement | null) => {
      const slotId = `${id}:${slot}`;
      if (node) scaleNodes.current.set(slotId, { node, delta });
      else scaleNodes.current.delete(slotId);
    };

  return (
    <GlassFilterRegistryContext.Provider value={api}>
      {children}
      <svg
        aria-hidden="true"
        focusable="false"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        colorInterpolationFilters="sRGB"
      >
        <defs>
          {[...entries.values()].map(({ id, spec }) => (
            <filter
              key={id}
              id={id}
              x="-5%"
              y="-5%"
              width="110%"
              height="110%"
              colorInterpolationFilters="sRGB"
            >
              <feImage
                href={spec.mapUrl}
                x={spec.offsetX}
                y={spec.offsetY}
                width={spec.width}
                height={spec.height}
                preserveAspectRatio="none"
                result="mapRaw"
              />
              {/*
               * Tile the map infinitely: any sample outside the map falls back
               * to its (neutral) edge pixels instead of transparent black,
               * which feDisplacementMap would read as MAX displacement.
               */}
              <feTile in="mapRaw" result="map" />
              {spec.aberration > 0 ? (
                <>
                  <feDisplacementMap
                    ref={scaleRef(id, 0, spec.aberration)}
                    in="SourceGraphic"
                    in2="map"
                    scale={spec.scale + spec.aberration}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispR"
                  />
                  <feColorMatrix in="dispR" type="matrix" values={RED_ONLY} result="chR" />
                  <feDisplacementMap
                    ref={scaleRef(id, 1, 0)}
                    in="SourceGraphic"
                    in2="map"
                    scale={spec.scale}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispG"
                  />
                  <feColorMatrix in="dispG" type="matrix" values={GREEN_ONLY} result="chG" />
                  <feDisplacementMap
                    ref={scaleRef(id, 2, -spec.aberration)}
                    in="SourceGraphic"
                    in2="map"
                    scale={Math.max(0, spec.scale - spec.aberration)}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="dispB"
                  />
                  <feColorMatrix in="dispB" type="matrix" values={BLUE_ONLY} result="chB" />
                  <feComposite in="chR" in2="chG" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="rg" />
                  <feComposite in="rg" in2="chB" operator="arithmetic" k1={0} k2={1} k3={1} k4={0} result="rgb" />
                  <feGaussianBlur in="rgb" stdDeviation={spec.blur} result="blurred" />
                  <feColorMatrix in="blurred" type="saturate" values={String(spec.saturation / 100)} />
                </>
              ) : (
                <>
                  <feDisplacementMap
                    ref={scaleRef(id, 0, 0)}
                    in="SourceGraphic"
                    in2="map"
                    scale={spec.scale}
                    xChannelSelector="R"
                    yChannelSelector="G"
                    result="disp"
                  />
                  <feGaussianBlur in="disp" stdDeviation={spec.blur} result="blurred" />
                  <feColorMatrix in="blurred" type="saturate" values={String(spec.saturation / 100)} />
                </>
              )}
            </filter>
          ))}
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
  width: number;
  height: number;
  radius: number;
  bezel?: number;
  profile?: SurfaceProfileName | SurfaceProfileFn;
  /** User knob; 70 = physically accurate displacement. */
  displacementScale: number;
  /** CSS-px backdrop blur (converted to a Gaussian stdDeviation). */
  blur: number;
  /** Percent. */
  saturation: number;
  /** High tier only. */
  aberration: number;
}

export interface UseGlassFilterResult {
  filterId: string | null;
  baseScaleRef: MutableRefObject<number>;
  /** Direct DOM mutation of the feDisplacementMap scale, safe per frame. */
  setFilterScale: (base: number) => void;
}

export function useGlassFilter(opts: UseGlassFilterOptions): UseGlassFilterResult {
  const registry = useContext(GlassFilterRegistryContext);
  const instanceKey = useId();
  const [filterId, setFilterId] = useState<string | null>(null);
  const baseScaleRef = useRef(0);
  const filterIdRef = useRef<string | null>(null);
  filterIdRef.current = filterId;

  const {
    enabled,
    shared,
    width,
    height,
    radius,
    bezel,
    profile,
    displacementScale,
    blur,
    saturation,
    aberration,
  } = opts;

  useEffect(() => {
    if (!registry || !enabled || width < 2 || height < 2) {
      setFilterId(null);
      return;
    }
    let id: string | null = null;
    try {
      const map = getDisplacementMap({ width, height, radius, bezel, profile });
      const baseScale = 2 * map.maxAbs * (displacementScale / 70);
      baseScaleRef.current = baseScale;
      const blurStd = clamp(blur / 3, 1, 6);
      const key = [
        displacementMapCacheKey({ width, height, radius, bezel, profile }),
        `b${blurStd}`,
        `s${saturation}`,
        `a${aberration}`,
        `sc${Math.round(baseScale * 100)}`,
        shared ? 'shared' : instanceKey,
      ].join('|');
      id = registry.acquire({
        key,
        offsetX: map.offsetX,
        offsetY: map.offsetY,
        width: map.width,
        height: map.height,
        mapUrl: map.url,
        scale: baseScale,
        blur: blurStd,
        saturation,
        aberration,
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
    bezel,
    profile,
    displacementScale,
    blur,
    saturation,
    aberration,
    instanceKey,
  ]);

  const setFilterScale = useCallback(
    (base: number) => {
      if (registry && filterIdRef.current) registry.setScale(filterIdRef.current, base);
    },
    [registry],
  );

  return { filterId, baseScaleRef, setFilterScale };
}
