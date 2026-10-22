/**
 * Main-thread facade over the shared glyph/lens raster scheduler.
 *
 * Worker creation is lazy and only ever happens from a client effect: SSR
 * imports this module but never constructs a worker. When `Worker`,
 * `OffscreenCanvas` or the CSP policy refuses, the scheduler falls back to the
 * same pure computation on the main thread, with identical results. There is
 * one scheduler and at most two workers for both glyph tiles and rounded
 * lens maps.
 */

import GlyphRasterWorker from './rasterWorker?worker&inline';
import {
  generateLensMapImage,
  lensMapCacheEpoch,
  lensMapCacheKey,
  lensMapImageCacheKey,
  lensMapPixelsCacheKey,
  lookupLensMapImage,
  retainLensMapImage,
  type LensMapImage,
  type LensMapOptions,
} from './displacementMap';
import {
  DEFAULT_GLYPH_RING_WIDTH,
  generateGlyphRasterFromPrepared,
  glyphRasterCacheEpoch,
  glyphRasterCacheKey,
  normaliseGlyphRaster,
  retainGlyphRaster,
  type GlyphRaster,
  type GlyphRasterOptions,
  type NormalisedGlyphRaster,
} from './glyphLensMap';
import {
  GlyphTaskScheduler,
  type SchedulerSource,
  type SchedulerStats,
  type SchedulerWorker,
} from './rasterWorkerScheduler';
import type {
  RasterWorkerGlyphRequest,
  RasterWorkerInput,
  RasterWorkerLensRequest,
  RasterWorkerLensResult,
  RasterWorkerOutput,
} from './rasterWorkerProtocol';

export interface GlyphRasterJobGlyph {
  options: GlyphRasterOptions;
  coverage: Uint8ClampedArray;
}

export type GlyphRasterJobResult = (revision: number, rasters: GlyphRaster[], source: SchedulerSource) => void;

type GlyphScheduler = GlyphTaskScheduler<RasterWorkerInput, RasterWorkerOutput>;

let scheduler: GlyphScheduler | null = null;
let workerDisabled = false;

/** True when a real worker path is available in this environment. */
export function glyphRasterWorkerAvailable(): boolean {
  if (scheduler?.isWorkerDisabled()) workerDisabled = true;
  if (workerDisabled) return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  // A Worker constructor exists but may still be CSP-blocked; the scheduler
  // catches that at construction and permanently falls back.
  return true;
}

function createWorker(): SchedulerWorker | null {
  if (!glyphRasterWorkerAvailable()) return null;
  try {
    return new GlyphRasterWorker({ name: 'nico-glyph-raster' }) as unknown as SchedulerWorker;
  } catch {
    workerDisabled = true;
    return null;
  }
}

function requestToOptions(request: RasterWorkerGlyphRequest): GlyphRasterOptions {
  return {
    char: request.char,
    font: request.font,
    width: request.width,
    height: request.height,
    penX: request.penX,
    baseline: request.baseline,
    depth: request.depth,
    curvature: request.curvature,
    refraction: request.refraction,
    dpr: request.dpr,
    rasterScale: request.rasterScale,
    ringWidth: request.ringWidth,
  };
}

function rasterToResult(request: RasterWorkerGlyphRequest, raster: GlyphRaster) {
  return {
    index: request.index,
    key: raster.key,
    maskUrl: raster.maskUrl,
    ringUrl: raster.ringUrl,
    glintUrl: raster.glintUrl,
    mapUrl: raster.mapUrl,
    scale: raster.scale,
    edgeUsed: raster.edgeUsed,
    maxInside: raster.maxInside,
    pixelWidth: raster.pixelWidth,
    pixelHeight: raster.pixelHeight,
  };
}

function requestToGlyph(
  glyph: GlyphRasterJobGlyph,
  index: number,
): RasterWorkerGlyphRequest {
  const normalised = normaliseGlyphRaster(glyph.options);
  return {
    index,
    key: glyphRasterCacheKey(glyph.options),
    char: glyph.options.char,
    font: glyph.options.font,
    width: glyph.options.width,
    height: glyph.options.height,
    penX: glyph.options.penX,
    baseline: glyph.options.baseline,
    coverage: glyph.coverage,
    pixelWidth: normalised.pixelWidth,
    pixelHeight: normalised.pixelHeight,
    depth: glyph.options.depth,
    curvature: glyph.options.curvature,
    refraction: glyph.options.refraction,
    dpr: glyph.options.dpr ?? 1,
    rasterScale: normalised.rasterScale,
    ringWidth: glyph.options.ringWidth ?? DEFAULT_GLYPH_RING_WIDTH,
    epoch: normalised.epoch,
    coverageKey: normalised.keys.coverageKey,
    fieldKey: normalised.keys.fieldKey,
    mapKey: normalised.keys.mapKey,
    ringKey: normalised.keys.ringKey,
    glintKey: normalised.keys.glintKey,
    maskKey: normalised.keys.maskKey,
    mapUrlKey: normalised.keys.mapUrlKey,
  };
}

/** Rebuilds the exact keys/epoch used when the job was submitted. */
function requestToNormalised(request: RasterWorkerGlyphRequest): NormalisedGlyphRaster {
  return {
    epoch: request.epoch,
    quality: Math.min(4, Math.max(0.25, request.dpr ?? 1)),
    rasterScale: request.rasterScale,
    pixelWidth: request.pixelWidth,
    pixelHeight: request.pixelHeight,
    keys: {
      coverageKey: request.coverageKey,
      fieldKey: request.fieldKey,
      mapKey: request.mapKey,
      ringKey: request.ringKey,
      glintKey: request.glintKey,
      maskKey: request.maskKey,
      mapUrlKey: request.mapUrlKey,
    },
  };
}

/**
 * Yield to the event loop (not merely the microtask queue) between glyphs so a
 * fallback rasterisation still lets input and paint run.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setTimeout === 'function') setTimeout(resolve, 0);
    else resolve();
  });
}

/**
 * Fallback executor: same pure computation and split caches, just on the main
 * thread. It yields between glyphs so a long string still lets input/paint run.
 */
async function runFallback(
  input: RasterWorkerInput,
  isCancelled: () => boolean = () => false,
): Promise<RasterWorkerOutput> {
  if (input.kind === 'glyph') {
    const glyphs = [];
    for (const request of input.glyphs) {
      if (isCancelled()) throw new Error('nico-glass-kit: glyph raster fallback cancelled');
      const raster = generateGlyphRasterFromPrepared(
        requestToOptions(request),
        request.coverage,
        requestToNormalised(request),
      );
      if (!raster) throw new Error('nico-glass-kit: glyph raster fallback failed');
      glyphs.push(rasterToResult(request, raster));
      await yieldToEventLoop();
    }
    if (isCancelled()) throw new Error('nico-glass-kit: glyph raster fallback cancelled');
    return { kind: 'glyph', glyphs };
  }

  // A runtime/CSP failure can enter this fallback from a scheduler microtask.
  // Give pending input and painting an opportunity before the first map.
  await yieldToEventLoop();
  const maps: RasterWorkerLensResult[] = [];
  for (const request of input.maps) {
    if (isCancelled()) throw new Error('nico-glass-kit: lens map fallback cancelled');
    const image = lookupLensMapImage(request.options) ?? generateLensMapImage(request.options);
    if (!image.dataUrl) throw new Error('nico-glass-kit: lens map fallback failed');
    maps.push({
      index: request.index,
      key: request.key,
      imageKey: request.imageKey,
      dataUrl: image.dataUrl,
      maxScale: image.maxScale,
      width: image.width,
      height: image.height,
      pixelWidth: image.pixelWidth,
      pixelHeight: image.pixelHeight,
      quality: image.quality,
      rasterScale: image.rasterScale,
    });
    await yieldToEventLoop();
  }
  if (isCancelled()) throw new Error('nico-glass-kit: lens map fallback cancelled');
  return { kind: 'lens', maps };
}

function getScheduler(): GlyphScheduler {
  if (!scheduler) scheduler = new GlyphTaskScheduler(createWorker, runFallback, 2);
  return scheduler;
}

/**
 * Submits the latest exact-glyph request for one owner. Previous queued work
 * for the same owner is replaced; results from superseded revisions are
 * discarded by both the scheduler and GlassText.
 */
export function submitGlyphRasterJob(
  owner: string,
  revision: number,
  glyphs: GlyphRasterJobGlyph[],
  onResult: GlyphRasterJobResult,
  onError?: (error: unknown) => void,
): void {
  if (glyphs.length === 0) {
    onResult(revision, [], 'fallback');
    return;
  }

  let requests: RasterWorkerGlyphRequest[];
  let fallbackGlyphs: RasterWorkerGlyphRequest[];
  let transfer: Transferable[];
  try {
    // `baseRequests` borrows the main-thread coverage cache. When a worker is
    // available, `requests` gets one dedicated copy to transfer while the
    // base array stays alive for the fallback. In a fallback-only browser we
    // skip the copy entirely and hand the base input to the fallback.
    const baseRequests = glyphs.map(requestToGlyph);
    const canTransfer = glyphRasterWorkerAvailable();
    requests = canTransfer
      ? baseRequests.map((request) => ({ ...request, coverage: request.coverage.slice() }))
      : baseRequests;
    fallbackGlyphs = canTransfer ? baseRequests : requests;
    transfer = canTransfer
      ? requests.map((request) => request.coverage.buffer as ArrayBuffer)
      : [];
    for (const request of requests) {
      if (request.coverage.length !== request.pixelWidth * request.pixelHeight) {
        throw new RangeError('nico-glass-kit: glyph coverage does not match its tile');
      }
    }
  } catch (error) {
    onError?.(error);
    return;
  }

  const options = requests.map(requestToOptions);
  const epoch = glyphRasterCacheEpoch();
  const signature = JSON.stringify(
    requests.map((request) => [request.key, request.pixelWidth, request.pixelHeight]),
  );
  getScheduler().submit({
    owner,
    revision,
    signature,
    input: { kind: 'glyph', glyphs: requests },
    fallbackInput: { kind: 'glyph', glyphs: fallbackGlyphs },
    transfer,
    deliver: (deliveredRevision, output, source) => {
      try {
        if (output.kind !== 'glyph' || output.glyphs.length !== requests.length) {
          throw new Error('nico-glass-kit: glyph worker returned the wrong tile count');
        }
        const rasters: GlyphRaster[] = output.glyphs.map((result, index) => {
          const request = requests[index];
          if (result.key !== request.key) {
            throw new Error('nico-glass-kit: glyph worker returned a mismatched tile');
          }
          const raster: GlyphRaster = {
            key: result.key,
            maskUrl: result.maskUrl,
            ringUrl: result.ringUrl,
            glintUrl: result.glintUrl,
            mapUrl: result.mapUrl,
            scale: result.scale,
            width: request.width,
            height: request.height,
            pixelWidth: result.pixelWidth,
            pixelHeight: result.pixelHeight,
            edgeUsed: result.edgeUsed,
            maxInside: result.maxInside,
          };
          if (source === 'worker') retainGlyphRaster(raster, options[index], epoch);
          return raster;
        });
        onResult(deliveredRevision, rasters, source);
      } catch (error) {
        onError?.(error);
      }
    },
    fail: onError,
  });
}

export type LensMapJobResult = (
  revision: number,
  image: LensMapImage,
  source: SchedulerSource,
) => void;

/** True when the shared worker path (glyph or lens) is available. */
export function lensMapWorkerAvailable(): boolean {
  return glyphRasterWorkerAvailable();
}

/**
 * Latest-only rounded-rectangle map job on the shared pool. No buffers are
 * transferred, but the worker input and fallback input are independent option
 * snapshots so a future transfer cannot invalidate the fallback.
 */
export function submitLensMapJob(
  owner: string,
  revision: number,
  options: LensMapOptions,
  onResult: LensMapJobResult,
  onError?: (error: unknown) => void,
): void {
  let request: RasterWorkerLensRequest;
  let fallbackRequest: RasterWorkerLensRequest;
  let prepared: LensMapOptions;
  let epoch: number;
  try {
    prepared = { ...options, skipDataUrl: false };
    epoch = lensMapCacheEpoch();
    const key = lensMapCacheKey({ ...prepared, strength: 1 });
    request = {
      index: 0,
      key,
      pixelKey: lensMapPixelsCacheKey(prepared),
      imageKey: lensMapImageCacheKey(prepared),
      epoch,
      options: { ...prepared },
    };
    fallbackRequest = { ...request, options: { ...prepared } };
  } catch (error) {
    onError?.(error);
    return;
  }

  const signature = JSON.stringify([request.key, request.imageKey]);
  getScheduler().submit({
    owner,
    revision,
    signature,
    input: { kind: 'lens', maps: [request] },
    fallbackInput: { kind: 'lens', maps: [fallbackRequest] },
    transfer: [],
    deliver: (deliveredRevision, output, source) => {
      try {
        if (output.kind !== 'lens' || output.maps.length !== 1) {
          throw new Error('nico-glass-kit: lens worker returned the wrong map count');
        }
        const result = output.maps[0];
        if (result.key !== request.key || result.imageKey !== request.imageKey) {
          throw new Error('nico-glass-kit: lens worker returned a mismatched map');
        }
        const image: LensMapImage = {
          cacheKey: result.key,
          width: result.width,
          height: result.height,
          pixelWidth: result.pixelWidth,
          pixelHeight: result.pixelHeight,
          quality: result.quality,
          rasterScale: result.rasterScale,
          maxScale: result.maxScale,
          dataUrl: result.dataUrl,
        };
        if (source === 'worker') retainLensMapImage(image, prepared, epoch);
        onResult(deliveredRevision, image, source);
      } catch (error) {
        onError?.(error);
      }
    },
    fail: onError,
  });
}

function cancelSchedulerOwner(owner: string): void {
  if (!scheduler) return;
  if (scheduler.isWorkerDisabled()) workerDisabled = true;
  scheduler.cancelOwner(owner);
  if (scheduler.isDisposed()) scheduler = null;
}

/** Unmount: drop the owner's queued/running work and release idle workers. */
export function cancelGlyphRasterOwner(owner: string): void {
  cancelSchedulerOwner(owner);
}

/** Unmount: drop a rounded-map owner from the shared scheduler. */
export function cancelLensMapOwner(owner: string): void {
  cancelSchedulerOwner(owner);
}

/** Test/dev teardown: terminate both workers and forget the scheduler. */
export function resetGlyphRasterWorkerPool(): void {
  scheduler?.dispose();
  scheduler = null;
  workerDisabled = false;
}

export function glyphRasterWorkerPoolStats(): SchedulerStats {
  if (!scheduler) {
    return {
      workersCreated: 0,
      workersTerminated: 0,
      submitted: 0,
      started: 0,
      delivered: 0,
      deduped: 0,
      droppedPending: 0,
      staleResults: 0,
      fallbacks: 0,
      failed: 0,
      activeWorkers: 0,
      queued: 0,
      owners: 0,
    };
  }
  return scheduler.stats();
}
