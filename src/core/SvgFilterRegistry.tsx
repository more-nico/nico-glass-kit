/**
 * SVG filter registry: a hidden `<svg>` mounted by {@link GlassProvider} that
 * owns every `<filter>` node used by glass surfaces. Filters are keyed so
 * identical geometry/params share one node (Medium and immutable High tier),
 * while animated High instances get private entries they can retune freely.
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
  useLayoutEffect,
  useId,
  useMemo,
  useRef,
  useState,
  memo,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  generateLensMapImage,
  lensDisplacementScale,
  lookupLensMapImage,
  type LensMapImage,
  type LensMapOptions,
} from './displacementMap';
import {
  lensMapGeometryKey,
  lensMapOpticsKey,
  planLensMapUpdate,
  shouldCommitLensMapResult,
} from './displacementWorker';
import {
  cancelLensMapOwner,
  lensMapWorkerAvailable,
  submitLensMapJob,
} from './rasterWorkerPool';
import { createFilterStore, type FilterEntry } from './filterStore';
import {
  LENS_FILTER_COLOR_INTERPOLATION,
  lensChannelMatrix,
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

/**
 * Prebuilt displacement map, used instead of `generateLensMap` when the shape
 * is not a rounded rectangle (e.g. a glyph tile rasterised by `GlassText`).
 * `key` must identify the whole map (character + font + geometry + optics) so
 * identical tiles still share one filter node; blur/saturation/brightness/
 * dispersion and the filter graph assembly are reused unchanged.
 */
export interface GlassFilterPreset {
  key: string;
  /** Displacement map PNG data URL. */
  url: string;
  /** Base feDisplacementMap scale (px). */
  scale: number;
  /** Map/element box, CSS px. */
  width: number;
  height: number;
}

interface RegistryApi {
  acquire(spec: GlassFilterSpec): string;
  resize(id: string, spec: GlassFilterSpec): boolean;
  update(id: string, spec: GlassFilterSpec): boolean;
  release(id: string): void;
  setScale(id: string, base: number): void;
  setBrightness(id: string, amount: number): void;
}

export const GlassFilterRegistryContext = createContext<RegistryApi | null>(null);

export function SvgFilterRegistry({ children }: { children?: ReactNode }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [store] = useState(() => createFilterStore(uid));
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

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

  const filterNodes = useCallback((id: string): FilterNodes => {
    let nodes = nodesRef.current.get(id);
    if (!nodes) {
      nodes = { scale: new Map(), brightnessR: null, brightnessG: null, brightnessB: null };
      nodesRef.current.set(id, nodes);
    }
    return nodes;
  }, []);

  const acquire = store.acquire;
  const resize = store.resize;
  const update = store.update;

  const release = useCallback((id: string) => {
    if (store.release(id)) nodesRef.current.delete(id);
  }, [store]);

  const setScale = useCallback((id: string, base: number) => {
    const nodes = nodesRef.current.get(id);
    if (!nodes) return;
    for (const { node, ratio } of nodes.scale.values()) {
      const value = String(Math.max(0, base * ratio));
      if (node.getAttribute('scale') !== value) node.setAttribute('scale', value);
    }
  }, []);

  const setBrightness = useCallback((id: string, amount: number) => {
    const nodes = nodesRef.current.get(id);
    if (!nodes) return;
    const slope = String(Math.max(0, amount));
    for (const node of [nodes.brightnessR, nodes.brightnessG, nodes.brightnessB]) {
      if (node && node.getAttribute('slope') !== slope) node.setAttribute('slope', slope);
    }
  }, []);

  const api = useMemo<RegistryApi>(
    () => ({ acquire, resize, update, release, setScale, setBrightness }),
    [acquire, resize, update, release, setScale, setBrightness],
  );

  const renderEntry = useCallback((entry: FilterEntry) => {
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

    const { id, mapUrl, width, height, passes, ratios, region } = entry;
    let slot = 0;
    return <filter id={id} x={region.x} y={region.y} width={region.width} height={region.height}
      colorInterpolationFilters={LENS_FILTER_COLOR_INTERPOLATION}>
      <feImage href={mapUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="none" result="map"/>
      {passes.map((pass, index) => renderPass(id, ratios, pass, index, () => slot++))}
    </filter>;
  }, [filterNodes]);

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
          {entries.map(entry => <FilterGraph key={entry.id} entry={entry} render={renderEntry}/>)}
        </defs>
      </svg>
    </GlassFilterRegistryContext.Provider>
  );
}

// Count changes and other surfaces' resizes must not reconcile an unchanged
// graph (or detach/reattach its animation refs).
const FilterGraph = memo(function FilterGraph({ entry, render }: {
  entry: FilterEntry;
  render: (entry: FilterEntry) => ReactNode;
}) { return render(entry); });

export interface UseGlassFilterOptions {
  /** Whether a filter is needed at all (quality tier + known size). */
  enabled: boolean;
  /** true = share immutable geometry; false = private for elasticity/hover retuning. */
  shared: boolean;
  /** Lens geometry + material params (optics-resolved). Ignored with `preset`. */
  map: Omit<LensMapOptions, 'skipDataUrl'>;
  /** Prebuilt displacement map (glyph tiles); skips `generateLensMap`. */
  preset?: GlassFilterPreset;
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
  specRef: MutableRefObject<GlassFilterSpec | null>;
  baseScaleRef: MutableRefObject<number>;
  /** Direct DOM mutation of the feDisplacementMap scales, safe per frame. */
  setFilterScale: (base: number) => void;
  /** Direct DOM mutation of the brightness feFunc slopes, safe per frame. */
  setFilterBrightness: (amount: number) => void;
}

// Commit the resized map before paint, while keeping SSR free of layout effects.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
let nextLensOwner = 0;

export function useGlassFilter(opts: UseGlassFilterOptions): UseGlassFilterResult {
  const registry = useContext(GlassFilterRegistryContext);
  const instanceKey = useId();
  const [filterId, setFilterId] = useState<string | null>(null);
  // Async map commits mutate specRef outside React. GlassSurface's
  // useGlassRenderMember signature effect only runs on render, so bump this
  // revision to make the owning surface (and its batched atlas) observe the
  // changed specRef key. Synchronous first-map/size commits already render.
  const [, refreshRenderMember] = useState(0);
  const baseScaleRef = useRef(0);
  const specRef = useRef<GlassFilterSpec | null>(null);
  const ownedRef = useRef<{
    registry: RegistryApi;
    id: string;
    key: string;
    resizeKey: string | null;
  } | null>(null);

  const { enabled, shared, map, preset, blur, saturation, brightness, animateBrightness, dispersion } =
    opts;
  const { width, height, radius, edge, curvature, strength, dpr, rasterScale } = map;
  const presetKey = preset?.key;
  const presetUrl = preset?.url;
  const presetScale = preset?.scale;
  const presetWidth = preset?.width;
  const presetHeight = preset?.height;

  const [owner] = useState(() => `lens:${++nextLensOwner}`);
  const latestRef = useRef(opts);

  // The displayed map is intentionally separate from the public synchronous
  // cache: it may be a worker result retained in the split async image cache.
  const mapRef = useRef<{ dataUrl: string; shapeKey: string } | null>(null);
  const geometryKeyRef = useRef('');
  const opticsKeyRef = useRef('');
  const requestedOpticsKeyRef = useRef('');
  const revisionRef = useRef(0);
  const applyGraphRef = useRef<() => void>(() => {});

  const releaseOwned = (): void => {
    const owned = ownedRef.current;
    if (owned) owned.registry.release(owned.id);
    ownedRef.current = null;
    specRef.current = null;
  };

  /**
   * Rebuild/retune the filter graph from the currently displayed map and the
   * latest material props. This never generates a map.
   */
  const applyGraph = (): void => {
    const latest = latestRef.current;
    const displayed = mapRef.current;
    if (!registry || !displayed) return;

    const currentPreset = latest.preset;
    const filterWidth = currentPreset?.width ?? latest.map.width;
    const filterHeight = currentPreset?.height ?? latest.map.height;
    const baseScale = currentPreset
      ? currentPreset.scale ?? 0
      : lensDisplacementScale(latest.map.strength);
    const shapeKey = displayed.shapeKey;
    const key = [
      shapeKey,
      `b${latest.blur}`,
      `sat${latest.saturation}`,
      `br${latest.brightness}`,
      `ab${latest.animateBrightness ? 1 : 0}`,
      `x${latest.dispersion}`,
      `sc${Math.round(baseScale * 100)}`,
      latest.shared ? 'shared' : instanceKey,
    ].join('|');
    const spec: GlassFilterSpec = {
      key,
      width: filterWidth,
      height: filterHeight,
      mapUrl: displayed.dataUrl,
      scale: baseScale,
      blur: latest.blur,
      saturation: latest.saturation,
      brightness: latest.brightness,
      animateBrightness: latest.animateBrightness ?? false,
      dispersion: latest.dispersion,
    };
    baseScaleRef.current = baseScale;
    specRef.current = spec;

    // Size-only refreshes may keep their private graph and animation passes.
    // A map/material change falls through to update/acquire.
    const resizeKey = !latest.shared && currentPreset === undefined
      ? JSON.stringify([
          latest.map.radius, latest.map.edge, latest.map.curvature, latest.map.strength,
          latest.map.dpr, latest.map.rasterScale,
          latest.blur, latest.saturation, latest.brightness,
          latest.animateBrightness ?? false, latest.dispersion,
        ])
      : null;
    const owned = ownedRef.current;
    if (owned?.registry === registry && owned.key === key) return;
    if (owned?.registry === registry && resizeKey !== null &&
        owned.resizeKey === resizeKey && registry.resize(owned.id, spec)) {
      owned.key = key;
      return;
    }
    if (owned?.registry === registry && !latest.shared && registry.update(owned.id, spec)) {
      owned.key = key;
      owned.resizeKey = resizeKey;
      return;
    }
    releaseOwned();
    const id = registry.acquire(spec);
    specRef.current = spec;
    ownedRef.current = { registry, id, key, resizeKey };
    setFilterId(id);
  };
  useIsomorphicLayoutEffect(() => {
    latestRef.current = opts;
    applyGraphRef.current = applyGraph;
  });

  // Geometry updates have no per-update cleanup: only replaced graphs and the
  // final unmount release ownership. This also handles StrictMode's remount.
  useIsomorphicLayoutEffect(() => () => {
    revisionRef.current++;
    requestedOpticsKeyRef.current = '';
    mapRef.current = null;
    geometryKeyRef.current = '';
    opticsKeyRef.current = '';
    cancelLensMapOwner(owner);
    releaseOwned();
  }, [registry, owner]);

  useIsomorphicLayoutEffect(() => {
    const latest = latestRef.current;
    const currentPreset = latest.preset;
    const filterWidth = currentPreset?.width ?? latest.map.width;
    const filterHeight = currentPreset?.height ?? latest.map.height;

    if (!registry || !latest.enabled || filterWidth < 2 || filterHeight < 2) {
      revisionRef.current++;
      cancelLensMapOwner(owner);
      requestedOpticsKeyRef.current = '';
      mapRef.current = null;
      geometryKeyRef.current = '';
      opticsKeyRef.current = '';
      releaseOwned();
      setFilterId(null);
      return;
    }

    try {
      if (currentPreset) {
        if (!currentPreset.url) {
          throw new Error('nico-glass-kit: glyph lens map rasterisation unavailable');
        }
        // Glyph presets are already exact. Text/font/size changes are reflow,
        // not optics: replace the preset synchronously.
        const reflowKey = [
          currentPreset.key,
          currentPreset.url,
          `${filterWidth}x${filterHeight}`,
        ].join('|');
        if (geometryKeyRef.current !== reflowKey || !mapRef.current) {
          revisionRef.current++;
          cancelLensMapOwner(owner);
          requestedOpticsKeyRef.current = '';
          mapRef.current = { dataUrl: currentPreset.url, shapeKey: currentPreset.key };
          geometryKeyRef.current = reflowKey;
          opticsKeyRef.current = '';
        }
        applyGraphRef.current();
        return;
      }

      const options: LensMapOptions = { ...latest.map, skipDataUrl: false };
      const geometryKey = lensMapGeometryKey(options);
      const opticsKey = lensMapOpticsKey(options);
      const plan = planLensMapUpdate({
        hasMap: mapRef.current !== null,
        geometryKey: geometryKeyRef.current,
        opticsKey: opticsKeyRef.current,
        requestedOpticsKey: requestedOpticsKeyRef.current,
      }, {
        geometryKey,
        opticsKey,
        workerAvailable: lensMapWorkerAvailable(),
      });

      if (plan.kind === 'sync') {
        // First map and every size/DPR/export-scale change stay synchronous
        // and commit before paint.
        revisionRef.current++;
        cancelLensMapOwner(owner);
        requestedOpticsKeyRef.current = '';
        const image: LensMapImage =
          lookupLensMapImage(options) ?? generateLensMapImage(options);
        if (!image.dataUrl) throw new Error('nico-glass-kit: lens map rasterisation unavailable');
        mapRef.current = { dataUrl: image.dataUrl, shapeKey: image.cacheKey };
        geometryKeyRef.current = geometryKey;
        opticsKeyRef.current = opticsKey;
        applyGraphRef.current();
        return;
      }

      if (plan.kind === 'async') {
        // A worker result for this geometry may already be in the split cache
        // (e.g. the user dragged back). Commit it synchronously instead of
        // submitting a round trip; this remains exact, not a preview.
        const cachedImage = lookupLensMapImage(options);
        if (cachedImage) {
          revisionRef.current++;
          cancelLensMapOwner(owner);
          requestedOpticsKeyRef.current = '';
          mapRef.current = { dataUrl: cachedImage.dataUrl, shapeKey: cachedImage.cacheKey };
          geometryKeyRef.current = geometryKey;
          opticsKeyRef.current = opticsKey;
          applyGraphRef.current();
          return;
        }
        if (plan.invalidate) revisionRef.current++;
        if (plan.submit) {
          const revision = revisionRef.current;
          requestedOpticsKeyRef.current = opticsKey;
          submitLensMapJob(owner, revision, options, (delivered, image) => {
            const current = latestRef.current;
            if (!current.enabled || current.preset) return;
            let currentGeometry: string;
            let currentOptics: string;
            try {
              const currentOptions: LensMapOptions = {
                ...current.map,
                skipDataUrl: false,
              };
              currentGeometry = lensMapGeometryKey(currentOptions);
              currentOptics = lensMapOpticsKey(currentOptions);
            } catch {
              return;
            }
            // Latest-only: revision + current props must still describe the
            // requested geometry/optics. This prevents a stale map commit
            // even if a scheduler callback raced a reflow render.
            if (!shouldCommitLensMapResult({
              deliveredRevision: delivered,
              currentRevision: revisionRef.current,
              requestGeometryKey: geometryKey,
              currentGeometryKey: currentGeometry,
              requestOpticsKey: opticsKey,
              currentOpticsKey: currentOptics,
              enabled: current.enabled,
              hasPreset: Boolean(current.preset),
            })) return;
            mapRef.current = { dataUrl: image.dataUrl, shapeKey: image.cacheKey };
            geometryKeyRef.current = geometryKey;
            opticsKeyRef.current = opticsKey;
            requestedOpticsKeyRef.current = '';
            applyGraphRef.current();
            // Accepted async map: force the owning GlassSurface to render so
            // useGlassRenderMember sees the new specRef.key and refreshes its
            // batch atlas. Synchronous paths already run before that effect.
            refreshRenderMember((value) => value + 1);
          }, () => {
            if (revisionRef.current !== revision) return;
            // Worker and exact fallback both failed. Use the same recoverable
            // CSS fallback as a synchronous encode failure, rather than
            // silently keeping a map for different optical parameters.
            revisionRef.current++;
            cancelLensMapOwner(owner);
            requestedOpticsKeyRef.current = '';
            mapRef.current = null;
            geometryKeyRef.current = opticsKeyRef.current = '';
            releaseOwned();
            setFilterId(null);
          });
        }
        // Preview: old exact map, current strength/graph params. Never a
        // lower-resolution fallback.
        applyGraphRef.current();
        return;
      }

      // Same exact map: blur/saturation/brightness/dispersion and strength
      // are direct graph updates and never submit a map job.
      if (plan.invalidate) {
        revisionRef.current++;
        cancelLensMapOwner(owner);
        requestedOpticsKeyRef.current = '';
      }
      applyGraphRef.current();
    } catch {
      revisionRef.current++;
      cancelLensMapOwner(owner);
      requestedOpticsKeyRef.current = '';
      releaseOwned();
      setFilterId(null);
    }
  }, [
    registry,
    enabled,
    shared,
    presetKey,
    presetUrl,
    presetScale,
    presetWidth,
    presetHeight,
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
    owner,
  ]);

  // A replaced spring's cleanup must address its old graph, never the new
  // filterId from a mutable "latest id" ref.
  const setFilterScale = useCallback(
    (base: number) => {
      if (registry && filterId) registry.setScale(filterId, base);
    },
    [registry, filterId],
  );

  const setFilterBrightness = useCallback(
    (amount: number) => {
      if (registry && filterId) registry.setBrightness(filterId, amount);
    },
    [registry, filterId],
  );

  return { filterId, specRef, baseScaleRef, setFilterScale, setFilterBrightness };
}
