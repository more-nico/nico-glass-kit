import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import fixtures from '../../benchmarks/fixtures/glyph-pixels.json';
import { glyphCoverage } from '../../benchmarks/glyph-fixtures';
import { computeGlyphLensPixels, glyphRingAlpha, MAX_GLYPH_RASTER_PIXELS } from './glyphLensMap';

it.each(fixtures)('preserves frozen glyph pixels, SDF and highlight ring for $options',fixture=>{
  const {options,variant}=fixture;
  const result=computeGlyphLensPixels(glyphCoverage(options.width,options.height,variant),options);
  const hash=(value:ArrayBufferView)=>createHash('sha256').update(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)).digest('hex');
  expect(hash(result.pixels)).toBe(fixture.pixels);expect(hash(result.sdf)).toBe(fixture.sdf);
  expect(hash(glyphRingAlpha(result.sdf,options.width,options.height,4,true))).toBe(fixture.ring);
  expect(result.maxInside).toBe(fixture.maxInside);
});

it('rejects pathological glyph dimensions before EDT allocation',()=>{
  expect(()=>computeGlyphLensPixels(new Uint8ClampedArray(),{width:MAX_GLYPH_RASTER_PIXELS+1,height:1,edge:8,curvature:0.2,strength:1})).toThrow(RangeError);
  // A very narrow field still allocates the two-pixel padding on both axes.
  expect(()=>computeGlyphLensPixels(new Uint8ClampedArray(),{width:MAX_GLYPH_RASTER_PIXELS/2,height:1,edge:8,curvature:0.2,strength:1})).toThrow(RangeError);
});
