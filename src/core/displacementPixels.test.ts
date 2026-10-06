import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixtures from '../../benchmarks/fixtures/lens-pixels.json';
import { computeLensPixels } from './displacementMap';

// Frozen before optimization at 79b42b5. Includes odd axes, 1px maps,
// clamped radii, wide bevels and fractional/high DPR. Checks every byte,
// rather than comparing the optimized implementation with itself.
describe('original lens pixel encoding', () => {
  it.each(fixtures)('preserves baseline pixels for $options', ({ options, sha256 }) => {
    expect(createHash('sha256').update(computeLensPixels(options)).digest('hex')).toBe(sha256);
  });
});
