import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { computeGlyphLensPixels, glyphRingAlpha } from '../src/core/glyphLensMap';
import { glyphCoverage } from './glyph-fixtures';

const label = process.argv[2] ?? 'glyph-baseline';
const fixtures = [];
for (const [width, height, variant, curvature] of [[1,1,0,0],[19,31,1,0.2],[37,53,2,1],[128,160,0,0.2],[257,321,1,0.2],[513,449,0,0.2]]) {
  const options = { width, height, edge:8,curvature,strength:0.4,quality:2 };
  const result = computeGlyphLensPixels(glyphCoverage(width,height,variant),options);
  const hash = (value: ArrayBufferView) => createHash('sha256').update(new Uint8Array(value.buffer,value.byteOffset,value.byteLength)).digest('hex');
  fixtures.push({options,variant,pixels:hash(result.pixels),sdf:hash(result.sdf),ring:hash(glyphRingAlpha(result.sdf,width,height,4,true)),maxInside:result.maxInside});
}
const coverage = glyphCoverage(768,960);
const options = {width:768,height:960,edge:8,curvature:0.2,strength:0.4,quality:2};
for(let i=0;i<3;i++) computeGlyphLensPixels(coverage,options);
const times=[];let hash='';
for(let i=0;i<8;i++) {
  const start=performance.now(), result=computeGlyphLensPixels(coverage,options);
  times.push(performance.now()-start);hash=createHash('sha256').update(result.pixels).digest('hex');
}
const out=`benchmarks/results/${label}`;await mkdir(out,{recursive:true});
await writeFile(`${out}/glyph.json`,JSON.stringify({collectedAt:new Date().toISOString(),options,times,hash,fixtures},null,2));
if(process.env.FREEZE_GLYPH==='1') await writeFile('benchmarks/fixtures/glyph-pixels.json',JSON.stringify(fixtures,null,2));
console.log(JSON.stringify({label,times,hash},null,2));
