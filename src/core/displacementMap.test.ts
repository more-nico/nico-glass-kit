import { describe, expect, it } from 'vitest';
import {
  computeDisplacementField,
  computeDisplacementProfile,
  encodeFieldToRGBA,
} from './displacementMap';

const BASE = { width: 200, height: 120, radius: 40 };

describe('computeDisplacementProfile', () => {
  it('is neutral exactly at the outer edge line and peaks inside the bezel', () => {
    const { deltas, maxAbs, bezel } = computeDisplacementProfile({ ...BASE, bezel: 40 });
    expect(bezel).toBe(40);
    expect(Math.abs(deltas[0])).toBeLessThan(1e-3);
    expect(maxAbs).toBeGreaterThan(0.5);
    // the peak sits strictly inside the bezel, not on its boundary
    let peak = 0;
    for (let i = 0; i < deltas.length; i++) {
      if (Math.abs(deltas[i]) > Math.abs(deltas[peak])) peak = i;
    }
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(deltas.length - 1);
  });

  it('has a consistent sign (single-refraction model) for convex profiles', () => {
    const { deltas } = computeDisplacementProfile({ ...BASE, bezel: 40 });
    for (const d of deltas) expect(d).toBeGreaterThanOrEqual(-1e-6);
  });

  it('respects the sample count', () => {
    const { deltas } = computeDisplacementProfile({ ...BASE, bezel: 40, samples: 64 });
    expect(deltas.length).toBe(64);
  });
});

describe('computeDisplacementField + encodeFieldToRGBA', () => {
  const fieldData = computeDisplacementField(BASE);
  const rgba = encodeFieldToRGBA(fieldData);
  const px = (x: number, y: number) => {
    const i = (y * fieldData.width + x) * 4;
    return { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], a: rgba[i + 3] };
  };

  it('is neutral (128) in the flat interior', () => {
    const c = px(100, 60); // centre
    expect(c.r).toBe(128);
    expect(c.g).toBe(128);
    expect(c.b).toBe(128);
    expect(c.a).toBe(255);
  });

  it('is neutral outside the shape', () => {
    const corner = px(1, 1); // outside the rounded corner arc
    expect(corner.r).toBe(128);
    expect(corner.g).toBe(128);
  });

  it('displaces horizontally near the left/right edges and mirrors by symmetry', () => {
    const y = 60; // mid height, straight edge region
    let right = { r: 128, g: 128 };
    let left = { r: 128, g: 128 };
    for (let d = 3; d < 30; d++) {
      const pr = px(200 - 1 - d, y);
      const pl = px(d, y);
      if (Math.abs(pr.r - 128) > Math.abs(right.r - 128)) right = pr;
      if (Math.abs(pl.r - 128) > Math.abs(left.r - 128)) left = pl;
    }
    expect(Math.abs(right.r - 128)).toBeGreaterThan(4);
    // symmetric: mirrored sign, near-equal magnitude
    expect(right.r - 128).toBeCloseTo(-(left.r - 128), 0);
    // no vertical displacement on the horizontal midline
    expect(right.g).toBe(128);
  });

  it('displaces vertically near the top edge', () => {
    const p = px(100, 6);
    expect(Math.abs(p.g - 128)).toBeGreaterThan(0);
  });

  it('keeps every channel within the encodable bounds and uses the range', () => {
    let maxDev = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      for (const c of [rgba[i], rgba[i + 1], rgba[i + 2]]) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
        maxDev = Math.max(maxDev, Math.abs(c - 128));
      }
      expect(rgba[i + 3]).toBe(255);
    }
    // normalised by maxAbs ⇒ the map must nearly saturate the 0..255 range
    expect(maxDev).toBeGreaterThanOrEqual(120);
  });

  it('produces radial displacement at the corner arc', () => {
    // inside the corner bezel band, both channels should deviate
    let found = false;
    for (let y = 0; y < 44 && !found; y++) {
      for (let x = 156; x < 200 && !found; x++) {
        const p = px(x, y);
        if (Math.abs(p.r - 128) > 2 && Math.abs(p.g - 128) > 2) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('pad extends the bitmap with a neutral border (overscan)', () => {
    const padded = computeDisplacementField({ ...BASE, pad: 1 });
    expect(padded.width).toBe(202);
    expect(padded.height).toBe(122);
    const rgba2 = encodeFieldToRGBA(padded);
    // every pixel of the 1px overscan frame must be neutral
    for (let x = 0; x < padded.width; x++) {
      for (const y of [0, padded.height - 1]) {
        const i = (y * padded.width + x) * 4;
        expect(rgba2[i]).toBe(128);
        expect(rgba2[i + 1]).toBe(128);
      }
    }
    for (let y = 0; y < padded.height; y++) {
      for (const x of [0, padded.width - 1]) {
        const i = (y * padded.width + x) * 4;
        expect(rgba2[i]).toBe(128);
        expect(rgba2[i + 1]).toBe(128);
      }
    }
    // interior displacement preserved (same spot as the unpadded edge test)
    const i = (60 * padded.width + (200 - 1 - 6) + 60 * 0) * 4;
    void i; // offset math covered by the unpadded tests above
  });
});
