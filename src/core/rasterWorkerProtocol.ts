/**
 * Structured-clone-safe messages between the main thread and the shared
 * glyph/lens raster worker. Glyph jobs receive coverage pixels and pure
 * numbers (font rasterisation stays on the main thread); rounded-rectangle
 * lens jobs receive only pure geometry numbers.
 */

import type { LensMapOptions } from './displacementMap';

export interface RasterWorkerGlyphRequest {
  /** Index into the source text / layout.glyphs array. */
  index: number;
  /** Full glyph raster cache key (`glyphRasterCacheKey`). */
  key: string;
  char: string;
  font: string;
  /** Tile box, CSS px. */
  width: number;
  height: number;
  penX: number;
  baseline: number;
  /** Coverage alpha, physical px, row-major. Transferred to the worker. */
  coverage: Uint8ClampedArray;
  pixelWidth: number;
  pixelHeight: number;
  depth: number;
  curvature: number;
  refraction: number;
  /** Device pixel ratio before clamping; also used to rebuild the cache key. */
  dpr: number;
  rasterScale: number;
  ringWidth: number;
  /** Cache epoch captured when the keys were derived. */
  epoch: number;
  coverageKey: string;
  fieldKey: string;
  mapKey: string;
  ringKey: string;
  glintKey: string;
  maskKey: string;
  mapUrlKey: string;
}

export interface RasterWorkerGlyphResult {
  index: number;
  key: string;
  maskUrl: string;
  ringUrl: string;
  glintUrl: string;
  mapUrl: string;
  scale: number;
  edgeUsed: number;
  maxInside: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface RasterWorkerLensRequest {
  index: number;
  /** Image identity (geometry + export scale, strength-independent). */
  key: string;
  /** Split pixel-layer key; excludes strength and export scale. */
  pixelKey: string;
  /** Encoded-image key; includes geometry, export scale and cache epoch. */
  imageKey: string;
  /** Cache epoch captured when the keys were derived. */
  epoch: number;
  options: LensMapOptions;
}

export interface RasterWorkerLensResult {
  index: number;
  key: string;
  imageKey: string;
  dataUrl: string;
  maxScale: number;
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
  quality: number;
  rasterScale: number;
}

export type RasterWorkerInput =
  | { kind: 'glyph'; glyphs: RasterWorkerGlyphRequest[] }
  | { kind: 'lens'; maps: RasterWorkerLensRequest[] };

export type RasterWorkerOutput =
  | { kind: 'glyph'; glyphs: RasterWorkerGlyphResult[] }
  | { kind: 'lens'; maps: RasterWorkerLensResult[] };

export interface RasterWorkerRunMessage {
  type: 'run';
  jobId: number;
  revision: number;
  input: RasterWorkerInput;
}

export interface RasterWorkerDoneMessage {
  type: 'done';
  jobId: number;
  revision: number;
  output: RasterWorkerOutput;
}

export interface RasterWorkerErrorMessage {
  type: 'error';
  jobId: number;
  revision: number;
  message: string;
}

export type RasterWorkerReply = RasterWorkerDoneMessage | RasterWorkerErrorMessage;
