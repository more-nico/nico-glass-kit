/** Spatial packing is deliberately independent of React and the DOM. */
export interface BatchBox { x: number; y: number; width: number; height: number; coverage?: BatchBox; }

export function batchBounds(boxes: readonly BatchBox[]): BatchBox {
  const x = Math.floor(Math.min(...boxes.map(box => box.x)));
  const y = Math.floor(Math.min(...boxes.map(box => box.y)));
  return {
    x, y,
    width: Math.ceil(Math.max(...boxes.map(box => box.x + box.width))) - x,
    height: Math.ceil(Math.max(...boxes.map(box => box.y + box.height))) - y,
  };
}

export function boxesOverlap(a: BatchBox, b: BatchBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

export function packRenderBatches<T extends BatchBox>(boxes: readonly T[]): T[][] {
  const result: T[][] = [];
  let current: T[] = [];
  const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const box of sorted) {
    const next = [...current, box];
    const bounds = batchBounds(next);
    const area = next.reduce((sum, item) => sum + item.width * item.height, 0);
    if (current.length && (bounds.width > 1024 || bounds.height > 512 ||
      bounds.width * bounds.height > area * 1.8 || current.some(item => boxesOverlap(item.coverage ?? item, box.coverage ?? box)))) {
      result.push(current);
      current = [];
    }
    current.push(box);
  }
  if (current.length) result.push(current);
  return result;
}
