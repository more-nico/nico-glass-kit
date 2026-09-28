import { describe, expect, it } from 'vitest';
import {
  canAnimateElasticity,
  elasticityTarget,
  mapPointerToElasticityGroup,
  resolveElasticity,
  unionElasticityRects,
} from './elasticityGroup';

describe('unionElasticityRects', () => {
  it('covers all members and updates when the member list changes', () => {
    const first = { left: 10, top: 20, right: 30, bottom: 50 };
    const second = { left: 60, top: 5, right: 90, bottom: 25 };

    expect(unionElasticityRects([first, second])).toEqual({
      left: 10,
      top: 5,
      right: 90,
      bottom: 50,
    });
    expect(unionElasticityRects([second])).toEqual(second);
    expect(unionElasticityRects([])).toBeNull();
  });

  it('ignores empty or non-finite member rectangles', () => {
    expect(
      unionElasticityRects([
        { left: 0, top: 0, right: 0, bottom: 20 },
        { left: Number.NaN, top: 0, right: 20, bottom: 20 },
      ]),
    ).toBeNull();
  });
});

describe('mapPointerToElasticityGroup', () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 220 };

  it('maps the group center to a zero offset', () => {
    expect(mapPointerToElasticityGroup(rect, 60, 120)).toEqual({
      nx: 0,
      ny: 0,
      distance: 0,
    });
  });

  it('maps points inside the group bounds, including gaps between members', () => {
    expect(mapPointerToElasticityGroup(rect, 35, 70)).toEqual({
      nx: -0.25,
      ny: -0.25,
      distance: Math.min(1, Math.hypot(0.25, 0.25) * 2),
    });
  });

  it('accepts points on the boundary and resets for points outside it', () => {
    expect(mapPointerToElasticityGroup(rect, 10, 20)).not.toBeNull();
    expect(mapPointerToElasticityGroup(rect, 111, 120)).toBeNull();
    expect(mapPointerToElasticityGroup(rect, 60, 221)).toBeNull();
  });
});

describe('elasticity settings', () => {
  it('uses the group strength over a member strength, including zero', () => {
    expect(resolveElasticity(0.8, 0.35)).toBe(0.35);
    expect(resolveElasticity(0.8, 0)).toBe(0);
    expect(resolveElasticity(0.8)).toBe(0.8);
  });

  it('enables the spring only for high quality with a filter and positive strength', () => {
    expect(canAnimateElasticity('high', true, 0.2)).toBe(true);
    expect(canAnimateElasticity('medium', true, 0.2)).toBe(false);
    expect(canAnimateElasticity('high', true, 0)).toBe(false);
    expect(canAnimateElasticity('high', false, 0.2)).toBe(false);
  });

  it('applies one pointer field and group strength to spring targets', () => {
    expect(
      elasticityTarget(120, 0.5, { nx: 0.25, ny: -0.5, distance: 0.75 }),
    ).toEqual({ scale: 120 * (1 + 0.5 * 0.5 * (1 - 0.75 * 0.6)), tx: 3, ty: -6 });
  });
});
