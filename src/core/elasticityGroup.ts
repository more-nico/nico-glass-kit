export interface ElasticityRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ElasticityPointer {
  /** Pointer x within the group, normalized to -0.5..0.5. */
  nx: number;
  /** Pointer y within the group, normalized to -0.5..0.5. */
  ny: number;
  /** Distance from the group center, normalized and capped at 1. */
  distance: number;
}

export interface ElasticityTarget {
  scale: number;
  tx: number;
  ty: number;
}

/** Group strength takes precedence when present; otherwise keep the surface value. */
export function resolveElasticity(localElasticity: number, groupElasticity?: number): number {
  return groupElasticity ?? localElasticity;
}

/** The elastic spring is available only with the high tier and a ready filter. */
export function canAnimateElasticity(
  quality: 'low' | 'medium' | 'high',
  hasFilter: boolean,
  elasticity: number,
): boolean {
  return quality === 'high' && hasFilter && elasticity > 0;
}

export function elasticityTarget(
  baseScale: number,
  elasticity: number,
  pointer: ElasticityPointer,
): ElasticityTarget {
  return {
    scale: baseScale * (1 + elasticity * 0.5 * (1 - pointer.distance * 0.6)),
    tx: pointer.nx * elasticity * 24,
    ty: pointer.ny * elasticity * 24,
  };
}

/** Smallest viewport-space rectangle covering every valid member rectangle. */
export function unionElasticityRects(
  rects: readonly ElasticityRect[],
): ElasticityRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let found = false;

  for (const rect of rects) {
    if (
      !Number.isFinite(rect.left) ||
      !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.right) ||
      !Number.isFinite(rect.bottom) ||
      rect.right <= rect.left ||
      rect.bottom <= rect.top
    ) {
      continue;
    }
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
    found = true;
  }

  return found ? { left, top, right, bottom } : null;
}

/** Maps a viewport pointer into the shared group-space field, or null outside. */
export function mapPointerToElasticityGroup(
  rect: ElasticityRect,
  clientX: number,
  clientY: number,
): ElasticityPointer | null {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return null;
  if (
    clientX < rect.left ||
    clientX > rect.right ||
    clientY < rect.top ||
    clientY > rect.bottom
  ) {
    return null;
  }

  const nx = (clientX - (rect.left + width / 2)) / width;
  const ny = (clientY - (rect.top + height / 2)) / height;
  return { nx, ny, distance: Math.min(1, Math.hypot(nx, ny) * 2) };
}
