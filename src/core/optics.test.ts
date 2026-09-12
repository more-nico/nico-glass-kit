import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTICS, opticsToCssVars, resolveOptics } from './optics';

describe('DEFAULT_OPTICS', () => {
  it('matches the ported house material defaults', () => {
    expect(DEFAULT_OPTICS.blur).toBe(3);
    expect(DEFAULT_OPTICS.saturation).toBe(100);
    expect(DEFAULT_OPTICS.brightness).toBe(1.1);
    expect(DEFAULT_OPTICS.tint).toBe('light-dark(rgb(255 255 255), rgb(18 20 26))');
    expect(DEFAULT_OPTICS.tintStrength).toBe(0.2);
    expect(DEFAULT_OPTICS.refraction).toBe(1);
    expect(DEFAULT_OPTICS.depth).toBe(8);
    expect(DEFAULT_OPTICS.curvature).toBe(0.2);
    expect(DEFAULT_OPTICS.dispersion).toBe(0.1);
  });
});

describe('resolveOptics', () => {
  it('returns the defaults for empty input', () => {
    expect(resolveOptics()).toEqual(DEFAULT_OPTICS);
    expect(resolveOptics(null, undefined)).toEqual(DEFAULT_OPTICS);
  });

  it('merges sparse layers without dropping unspecified keys', () => {
    const merged = resolveOptics(DEFAULT_OPTICS, { blur: 18, refraction: 0.5 });
    expect(merged.blur).toBe(18);
    expect(merged.refraction).toBe(0.5);
    expect(merged.depth).toBe(DEFAULT_OPTICS.depth);
    expect(merged.tint).toBe(DEFAULT_OPTICS.tint);
  });

  it('lets the last layer win', () => {
    const merged = resolveOptics({ blur: 8 }, { blur: 26 }, { curvature: 0.9 });
    expect(merged.blur).toBe(26);
    expect(merged.curvature).toBe(0.9);
  });

  it('ignores undefined values inside layers', () => {
    const merged = resolveOptics(DEFAULT_OPTICS, { blur: undefined, depth: 16 });
    expect(merged.blur).toBe(DEFAULT_OPTICS.blur);
    expect(merged.depth).toBe(16);
  });

  it('ignores hostile own keys instead of copying them', () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "blur": 26, "constructor": {"x": 1}}');
    const merged = resolveOptics(DEFAULT_OPTICS, hostile);
    expect(merged.blur).toBe(26);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect((merged as unknown as Record<string, unknown>).polluted).toBeUndefined();
    expect((merged as unknown as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('opticsToCssVars', () => {
  it('maps every optics key to its public CSS variable', () => {
    const vars = opticsToCssVars(DEFAULT_OPTICS);
    expect(vars['--ngs-glass-blur']).toBe('3px');
    expect(vars['--ngs-glass-saturation']).toBe('100%');
    expect(vars['--ngs-glass-brightness']).toBe('1.1');
    expect(vars['--ngs-glass-tint']).toBe(DEFAULT_OPTICS.tint);
    expect(vars['--ngs-glass-tint-strength']).toBe('0.2');
    expect(vars['--ngs-lens-refraction']).toBe('1');
    expect(vars['--ngs-lens-depth']).toBe('8px');
    expect(vars['--ngs-lens-curvature']).toBe('0.2');
    expect(vars['--ngs-lens-dispersion']).toBe('0.1');
  });

  it('emits only the provided subset', () => {
    const vars = opticsToCssVars({ blur: 26 });
    expect(Object.keys(vars)).toEqual(['--ngs-glass-blur']);
    expect(vars['--ngs-glass-blur']).toBe('26px');
  });
});
