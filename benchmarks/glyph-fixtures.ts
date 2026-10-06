/** Deterministic coverage masks with holes, thin strokes and antialiased edges. */
export function glyphCoverage(width: number, height: number, variant = 0): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const nx = (x + 0.5) / width - 0.5, ny = (y + 0.5) / height - 0.5;
    const d = Math.hypot(nx, ny * 0.85);
    const ring = d > 0.23 && d < 0.43;
    const stem = Math.abs(nx) < 0.035 && Math.abs(ny) < 0.48;
    const inside = variant % 3 === 0 ? ring : variant % 3 === 1 ? ring || stem : stem;
    alpha[y * width + x] = inside ? 255 : Math.abs(d - 0.23) < 0.009 ? (x + y) % 2 ? 127 : 128 : 0;
  }
  return alpha;
}
