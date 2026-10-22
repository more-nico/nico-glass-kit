/**
 * Pure planning helpers for the rounded-rectangle async map path.
 *
 * The distinction is deliberate:
 *  - geometry/reflow (size, DPR, export raster scale, first map) stays
 *    synchronous and blocks before paint;
 *  - optics (radius/edge/curvature) may be recomputed by the shared worker
 *    while the previous same-tier high-resolution map stays on screen;
 *  - strength, blur, saturation, brightness and dispersion never need a new
 *    map and are graph-only updates.
 *
 * Keeping this decision pure makes the latest-only/stale rules testable
 * without a DOM.
 */

import { normaliseLensOptions, type LensMapOptions } from './displacementMap';

const round = (value: number, decimals = 3): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Size/DPR/export-scale identity. A change requires a synchronous refresh. */
export function lensMapGeometryKey(options: LensMapOptions): string {
  const shape = normaliseLensOptions(options);
  return [
    `${shape.width}x${shape.height}`,
    `@${round(shape.quality, 3)}`,
    `${shape.pixelWidth}x${shape.pixelHeight}`,
    `m:${round(shape.rasterScale, 3)}`,
  ].join('|');
}

/**
 * Optics that change pixels. Strength is excluded: it only scales the SVG
 * displacement and is applied directly to the graph.
 */
export function lensMapOpticsKey(options: LensMapOptions): string {
  const shape = normaliseLensOptions(options);
  return [
    `r:${round(shape.radius, 3)}`,
    `e:${round(shape.edge, 3)}`,
    `p:${round(shape.curvature, 4)}`,
  ].join('|');
}

export interface LensMapUpdateState {
  hasMap: boolean;
  /** Identity of the currently displayed map's geometry. */
  geometryKey: string;
  /** Optics of the currently displayed exact map. */
  opticsKey: string;
  /** Optics of the latest submitted worker job, if any. */
  requestedOpticsKey: string;
}

export interface LensMapUpdateInput {
  geometryKey: string;
  opticsKey: string;
  workerAvailable: boolean;
}

export type LensMapUpdatePlan =
  | { kind: 'sync'; invalidate: true }
  | { kind: 'async'; submit: boolean; invalidate: boolean }
  | { kind: 'graph'; invalidate: boolean };

export interface LensMapCommitState {
  deliveredRevision: number;
  currentRevision: number;
  requestGeometryKey: string;
  currentGeometryKey: string;
  requestOpticsKey: string;
  currentOpticsKey: string;
  enabled: boolean;
  hasPreset: boolean;
}

/** Latest-only commit gate for a worker result. */
export function shouldCommitLensMapResult(state: LensMapCommitState): boolean {
  return state.enabled &&
    !state.hasPreset &&
    state.deliveredRevision === state.currentRevision &&
    state.requestGeometryKey === state.currentGeometryKey &&
    state.requestOpticsKey === state.currentOpticsKey;
}

export function planLensMapUpdate(
  state: LensMapUpdateState,
  next: LensMapUpdateInput,
): LensMapUpdatePlan {
  // First map, resize/reflow, DPR or export raster scale: synchronous by
  // contract. Text/glyph presets never enter this planner.
  if (!state.hasMap || state.geometryKey !== next.geometryKey) {
    return { kind: 'sync', invalidate: true };
  }

  if (state.opticsKey !== next.opticsKey) {
    // Shared/private only decides whether the graph is updated or re-acquired;
    // both can use the worker and keep their previous exact map as preview.
    if (next.workerAvailable) {
      const submit = state.requestedOpticsKey !== next.opticsKey;
      return { kind: 'async', submit, invalidate: submit };
    }
    return { kind: 'sync', invalidate: true };
  }

  // Same exact map: only graph parameters (or strength) changed. If an old
  // request for this same optics is somehow still pending, invalidate it; it
  // cannot improve on the displayed exact map.
  return { kind: 'graph', invalidate: state.requestedOpticsKey !== '' };
}
