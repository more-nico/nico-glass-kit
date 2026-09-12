import { describe, expect, it } from 'vitest';
import {
  createLensFilter,
  DISPERSION_SCALE_EPSILON,
  isSourceAreaSafe,
  lensChannelMatrix,
  lensPassScaleRatios,
  lensRegionPercent,
  lensSaturationMatrix,
} from './lensFilter';

const BASE = {
  mapUrl: 'data:image/png;base64,AAA',
  width: 200,
  height: 120,
  scale: 48,
};

describe('createLensFilter', () => {
  it('emits a single displacement pass without dispersion', () => {
    const d = createLensFilter(BASE);
    const displacement = d.passes.filter((p) => p.type === 'displacement');
    expect(displacement).toHaveLength(1);
    expect(displacement[0]).toMatchObject({ scale: 48, map: 'map' });
    expect(d.passes.some((p) => p.type === 'blend')).toBe(false);
  });

  it('keeps blur, saturation and brightness inside the graph, in order', () => {
    const d = createLensFilter({ ...BASE, blur: 4, saturation: 110, brightness: 1.8 });
    expect(d.passes[0]).toMatchObject({ type: 'blur', sigma: 2 });
    expect(d.passes[1]).toMatchObject({ type: 'saturate', amount: 1.1 });
    expect(d.passes[2]).toMatchObject({ type: 'brightness', amount: 1.8 });
    expect(d.passes[3]).toMatchObject({ type: 'displacement' });
  });

  it('omits no-op material passes at the defaults', () => {
    const d = createLensFilter({ ...BASE, blur: 0, saturation: 100, brightness: 1 });
    expect(d.passes[0]).toMatchObject({ type: 'displacement' });
  });

  it('splits dispersion into three RGB displacement passes blended with screen', () => {
    const d = createLensFilter({ ...BASE, dispersion: 0.5 });
    const displacements = d.passes.filter((p) => p.type === 'displacement');
    expect(displacements).toHaveLength(3);
    const delta = 48 * 0.5 * DISPERSION_SCALE_EPSILON;
    expect(displacements[0]).toMatchObject({ scale: 48 + delta, result: 'ngs_disp_r' });
    expect(displacements[1]).toMatchObject({ scale: 48, result: 'ngs_disp_g' });
    expect(displacements[2]).toMatchObject({ scale: 48 - delta, result: 'ngs_disp_b' });
    const channels = d.passes.filter((p) => p.type === 'channel');
    expect(channels).toHaveLength(3);
    const blends = d.passes.filter((p) => p.type === 'blend');
    expect(blends).toHaveLength(2);
    expect(blends.every((p) => p.mode === 'screen')).toBe(true);
  });

  it('sizes the filter region for blur bleed and dispersion spread', () => {
    const d = createLensFilter({ ...BASE, blur: 4, dispersion: 0.5 });
    const expected = Math.ceil(Math.max(4 * 1.5, 4) + 48 + 48 * 0.5 * DISPERSION_SCALE_EPSILON + 2);
    expect(d.regionPaddingPx).toBe(expected); // 61
    const region = lensRegionPercent(d.width, d.height, d.regionPaddingPx);
    expect(region.x).toBe(`${(-expected / d.width) * 100}%`);
    expect(parseFloat(region.width)).toBeGreaterThan(100);
  });

  it('flags oversized source areas for degradation', () => {
    expect(isSourceAreaSafe(800, 600, 1)).toBe(true);
    expect(isSourceAreaSafe(1600, 1200, 2)).toBe(false);
  });
});

describe('matrices', () => {
  it('uses the identity saturation matrix at amount 1', () => {
    const values = lensSaturationMatrix(1).split(/\s+/).map(Number);
    expect(values).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]);
  });

  it('keeps the alpha row for every channel matrix', () => {
    for (const channel of ['r', 'g', 'b'] as const) {
      const values = lensChannelMatrix(channel).split(/\s+/).map(Number);
      expect(values).toHaveLength(20);
      expect(values[19]).toBe(1); // alpha passthrough
      expect(values[18]).toBe(0);
    }
  });
});

describe('lensPassScaleRatios', () => {
  it('is empty without a displacement pass', () => {
    expect(lensPassScaleRatios([{ type: 'blur', input: 'a', sigma: 1, result: 'b' }], 48)).toEqual(
      [],
    );
  });

  it('is empty for a non-positive base scale', () => {
    expect(lensPassScaleRatios([{ type: 'displacement', input: 'a', map: 'm', scale: 12 }], 0)).toEqual(
      [],
    );
  });

  it('is 1 for a single displacement pass at the base scale', () => {
    const d = createLensFilter(BASE);
    expect(lensPassScaleRatios(d.passes, 48)).toEqual([1]);
  });

  it('mirrors the dispersion scale offsets multiplicatively around 1', () => {
    const d = createLensFilter({ ...BASE, dispersion: 0.5 });
    const delta = 48 * 0.5 * DISPERSION_SCALE_EPSILON;
    expect(lensPassScaleRatios(d.passes, 48)).toEqual([
      (48 + delta) / 48,
      1,
      (48 - delta) / 48,
    ]);
  });
});
