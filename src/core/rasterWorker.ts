/**
 * Shared raster worker: exact glyph EDT/displacement/ring computation and
 * rounded-rectangle lens maps, with PNG encoding, off the main thread.
 *
 * Font drawing and layout never happen here — the main thread sends coverage
 * pixels so the worker cannot resolve a different installed font. Caches are
 * split by layer and byte-bounded; terminating the worker releases them.
 */

import {
  clampLensMapRasterScale,
  computeLensPixels,
  lensDisplacementScale,
  lensEdgePixels,
  lensMapRasterSize,
  normaliseLensOptions,
} from './displacementMap';
import {
  DEFAULT_GLYPH_THRESHOLD,
  GLYPH_GLINT_WIDTH,
  computeGlyphField,
  computeGlyphLensPixelsFromField,
  glyphRingAlpha,
  alphaToWhiteRgba,
  type GlyphField,
} from './rasterWorkerCompute';
import type {
  RasterWorkerGlyphRequest,
  RasterWorkerGlyphResult,
  RasterWorkerLensRequest,
  RasterWorkerLensResult,
  RasterWorkerOutput,
  RasterWorkerRunMessage,
} from './rasterWorkerProtocol';

/** Worker-side budgets; independent from the main-thread caches. */
const FIELD_CACHE_BYTES = 32 * 1024 * 1024;
const MAP_CACHE_BYTES = 24 * 1024 * 1024;
const RING_CACHE_BYTES = 8 * 1024 * 1024;
const ENCODED_CACHE_BYTES = 16 * 1024 * 1024;
/** Rounded-rectangle full-resolution RGBA; at 4K/DPR2 one map can be ~35MB. */
const LENS_PIXELS_CACHE_BYTES = 48 * 1024 * 1024;
const LENS_IMAGE_CACHE_BYTES = 16 * 1024 * 1024;
const LENS_PIXELS_CACHE_LIMIT = 32;
const LENS_IMAGE_CACHE_LIMIT = 64;

interface Bytes {
  bytes: number;
}

function lruGet<T extends Bytes>(cache: Map<string, T>, key: string): T | undefined {
  const value = cache.get(key);
  if (!value) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function lruPut<T extends Bytes>(
  cache: Map<string, T>,
  key: string,
  value: T,
  byteLimit: number,
  entryLimit = Number.POSITIVE_INFINITY,
): void {
  const previous = cache.get(key);
  if (previous) cache.delete(key);
  cache.set(key, value);
  let bytes = 0;
  for (const entry of cache.values()) bytes += entry.bytes;
  while (cache.size > 0 && (bytes > byteLimit || cache.size > entryLimit)) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const evicted = cache.get(oldest)!;
    bytes -= evicted.bytes;
    cache.delete(oldest);
  }
}

const fieldCache = new Map<string, { field: GlyphField; bytes: number }>();
const mapCache = new Map<string, { pixels: Uint8ClampedArray; bytes: number }>();
const ringCache = new Map<string, { alpha: Uint8ClampedArray; bytes: number }>();
const encodedCache = new Map<string, { url: string; bytes: number; maxInside?: number }>();
const lensPixelsCache = new Map<string, { pixels: Uint8ClampedArray; bytes: number }>();
const lensImageCache = new Map<string, { url: string; bytes: number }>();

const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

function getField(glyph: RasterWorkerGlyphRequest): GlyphField {
  const cached = lruGet(fieldCache, glyph.fieldKey);
  if (cached) return cached.field;
  const field = computeGlyphField(
    glyph.coverage,
    glyph.pixelWidth,
    glyph.pixelHeight,
    DEFAULT_GLYPH_THRESHOLD,
    true,
  );
  lruPut(fieldCache, glyph.fieldKey, {
    field,
    bytes: field.sdf.byteLength + field.nx.byteLength + field.ny.byteLength,
  }, FIELD_CACHE_BYTES);
  return field;
}

function getMapPixels(glyph: RasterWorkerGlyphRequest, field: GlyphField): Uint8ClampedArray {
  const cached = lruGet(mapCache, glyph.mapKey);
  if (cached) return cached.pixels;
  const lens = computeGlyphLensPixelsFromField(field, {
    width: glyph.pixelWidth,
    height: glyph.pixelHeight,
    edge: glyph.depth,
    curvature: glyph.curvature,
    strength: glyph.refraction,
    quality: clamp(glyph.dpr ?? 1, 0.25, 4),
  });
  lruPut(mapCache, glyph.mapKey, {
    pixels: lens.pixels,
    bytes: lens.pixels.byteLength,
  }, MAP_CACHE_BYTES);
  return lens.pixels;
}

function getRing(
  glyph: RasterWorkerGlyphRequest,
  field: GlyphField,
  key: string,
  widthPx: number,
  feather: boolean,
): Uint8ClampedArray {
  const cached = lruGet(ringCache, key);
  if (cached) return cached.alpha;
  const alpha = glyphRingAlpha(
    field.sdf,
    glyph.pixelWidth,
    glyph.pixelHeight,
    widthPx,
    feather,
  );
  lruPut(ringCache, key, { alpha, bytes: alpha.byteLength }, RING_CACHE_BYTES);
  return alpha;
}

interface EncodeCanvas {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
}

let alphaSurface: EncodeCanvas | null = null;
let mapSourceSurface: EncodeCanvas | null = null;
let mapTargetSurface: EncodeCanvas | null = null;

function surface(
  current: EncodeCanvas | null,
  width: number,
  height: number,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D | null } {
  let entry = current;
  if (!entry) {
    entry = { canvas: new OffscreenCanvas(width, height), width, height };
  } else if (entry.width !== width || entry.height !== height) {
    entry.canvas.width = width;
    entry.canvas.height = height;
    entry.width = width;
    entry.height = height;
  }
  return {
    canvas: entry.canvas,
    // Encoding reads the bitmap back; keep it on the CPU like the main-thread
    // encoder instead of routing it through the GPU/compositor.
    ctx: entry.canvas.getContext('2d', { willReadFrequently: true }),
  };
}

function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error ?? new Error('glyph raster encode failed'));
      reader.readAsDataURL(blob);
    });
  }
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:image/png;base64,${btoa(binary)}`;
  });
}

async function encodeAlpha(alpha: Uint8ClampedArray, width: number, height: number): Promise<string> {
  const { canvas, ctx } = surface(alphaSurface, width, height);
  alphaSurface = { canvas, width, height };
  if (!ctx) return '';
  const image = ctx.createImageData(width, height);
  image.data.set(alphaToWhiteRgba(alpha));
  ctx.putImageData(image, 0, 0);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

async function encodePixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): Promise<string> {
  const source = surface(mapSourceSurface, width, height);
  mapSourceSurface = { canvas: source.canvas, width, height };
  if (!source.ctx) return '';
  source.ctx.putImageData(new ImageData(pixels, width, height), 0, 0);

  const raster = lensMapRasterSize(width, height, clampLensMapRasterScale(scale));
  if (raster.width === width && raster.height === height) {
    return blobToDataUrl(await source.canvas.convertToBlob({ type: 'image/png' }));
  }

  const target = surface(mapTargetSurface, raster.width, raster.height);
  mapTargetSurface = { canvas: target.canvas, width: raster.width, height: raster.height };
  if (!target.ctx) return '';
  target.ctx.imageSmoothingEnabled = true;
  target.ctx.imageSmoothingQuality = 'high';
  target.ctx.drawImage(source.canvas, 0, 0, raster.width, raster.height);
  return blobToDataUrl(await target.canvas.convertToBlob({ type: 'image/png' }));
}

async function cachedDataUrl(
  key: string,
  encode: () => Promise<string>,
  maxInside?: number,
): Promise<string> {
  const cached = lruGet(encodedCache, key);
  if (cached) return cached.url;
  const url = await encode();
  if (!url) throw new Error('nico-glass-kit: glyph raster encoding failed');
  lruPut(encodedCache, key, {
    url,
    bytes: url.length * 2,
    ...(maxInside === undefined ? null : { maxInside }),
  }, ENCODED_CACHE_BYTES);
  return url;
}

async function rasterise(glyph: RasterWorkerGlyphRequest): Promise<RasterWorkerGlyphResult> {
  if (glyph.coverage.length !== glyph.pixelWidth * glyph.pixelHeight) {
    throw new RangeError('nico-glass-kit: glyph coverage does not match its tile');
  }
  const quality = clamp(glyph.dpr ?? 1, 0.25, 4);
  const field = getField(glyph);
  const pixels = getMapPixels(glyph, field);
  const ring = getRing(
    glyph,
    field,
    glyph.ringKey,
    Math.max(0, glyph.ringWidth) * quality,
    true,
  );
  const glint = getRing(
    glyph,
    field,
    glyph.glintKey,
    GLYPH_GLINT_WIDTH * quality,
    false,
  );

  const maskUrl = await cachedDataUrl(
    glyph.maskKey,
    () => encodeAlpha(glyph.coverage, glyph.pixelWidth, glyph.pixelHeight),
  );
  const ringUrl = await cachedDataUrl(
    glyph.ringKey,
    () => encodeAlpha(ring, glyph.pixelWidth, glyph.pixelHeight),
  );
  const glintUrl = await cachedDataUrl(
    glyph.glintKey,
    () => encodeAlpha(glint, glyph.pixelWidth, glyph.pixelHeight),
  );
  const mapUrl = await cachedDataUrl(
    glyph.mapUrlKey,
    () => encodePixels(pixels, glyph.pixelWidth, glyph.pixelHeight, glyph.rasterScale),
    field.maxInside,
  );

  return {
    index: glyph.index,
    key: glyph.key,
    maskUrl,
    ringUrl,
    glintUrl,
    mapUrl,
    scale: lensDisplacementScale(clamp(glyph.refraction, 0, 1)),
    edgeUsed: lensEdgePixels(glyph.depth, quality),
    maxInside: field.maxInside,
    pixelWidth: glyph.pixelWidth,
    pixelHeight: glyph.pixelHeight,
  };
}

function getLensPixels(request: RasterWorkerLensRequest): Uint8ClampedArray {
  const cached = lruGet(lensPixelsCache, request.pixelKey);
  if (cached) return cached.pixels;
  const pixels = computeLensPixels(request.options);
  lruPut(lensPixelsCache, request.pixelKey, {
    pixels,
    bytes: pixels.byteLength,
  }, LENS_PIXELS_CACHE_BYTES, LENS_PIXELS_CACHE_LIMIT);
  return pixels;
}

async function rasteriseLens(request: RasterWorkerLensRequest): Promise<RasterWorkerLensResult> {
  const shape = normaliseLensOptions(request.options);
  const cached = lruGet(lensImageCache, request.imageKey);
  let dataUrl = cached?.url ?? '';
  if (!dataUrl) {
    const pixels = getLensPixels(request);
    dataUrl = await encodePixels(
      pixels,
      shape.pixelWidth,
      shape.pixelHeight,
      shape.rasterScale,
    );
    if (!dataUrl) throw new Error('nico-glass-kit: lens map encoding failed');
    lruPut(lensImageCache, request.imageKey, {
      url: dataUrl,
      bytes: dataUrl.length * 2,
    }, LENS_IMAGE_CACHE_BYTES, LENS_IMAGE_CACHE_LIMIT);
  }
  return {
    index: request.index,
    key: request.key,
    imageKey: request.imageKey,
    dataUrl,
    maxScale: lensDisplacementScale(shape.strength),
    width: shape.width,
    height: shape.height,
    pixelWidth: shape.pixelWidth,
    pixelHeight: shape.pixelHeight,
    quality: shape.quality,
    rasterScale: shape.rasterScale,
  };
}

async function run(message: RasterWorkerRunMessage): Promise<RasterWorkerOutput> {
  if (message.input.kind === 'glyph') {
    const glyphs: RasterWorkerGlyphResult[] = [];
    for (const glyph of message.input.glyphs) glyphs.push(await rasterise(glyph));
    return { kind: 'glyph', glyphs };
  }
  const maps: RasterWorkerLensResult[] = [];
  for (const map of message.input.maps) maps.push(await rasteriseLens(map));
  return { kind: 'lens', maps };
}

const scope = self as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

let chain: Promise<void> = Promise.resolve();

scope.onmessage = (event: MessageEvent): void => {
  const message = event.data as RasterWorkerRunMessage | null;
  if (!message || message.type !== 'run') return;
  chain = chain.then(async () => {
    try {
      const output = await run(message);
      scope.postMessage({
        type: 'done',
        jobId: message.jobId,
        revision: message.revision,
        output,
      });
    } catch (error) {
      scope.postMessage({
        type: 'error',
        jobId: message.jobId,
        revision: message.revision,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
};
