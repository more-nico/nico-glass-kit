// Preserve measured data and unscaled screenshot crops without rebuilding either fixture.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evidenceFiles, screenshotPair, sha256 } from './lib/evidence.mjs';

const root = resolve('benchmarks');
const out = resolve(root, 'evidence');
// This packages the archived first experiment, never a later working tree.
// Refuse before touching evidence if the build no longer matches that run.
const firstRoundHash = '228c4450bbf1c1cc84006a3b706ede3a446357b1dfde695b2b30566d7c8605ff';
const measuredJS = await readFile(resolve('.benchmark-dist/assets/index-BaD-mqQT.js'));
if (sha256(measuredJS) !== firstRoundHash) {
  throw Error('First-round build mismatch; use a new evidence directory for a new experiment.');
}
await mkdir(out, { recursive: true });
const copies = [
  ['baseline/results.json', 'baseline.json'],
  ['final-v2/results.json', 'optimized.json'],
  ['baseline/stress.json', 'baseline-stress.json'],
  ['final-v2/stress.json', 'optimized-stress.json'],
  ['comparison/summary.json', 'summary.json'],
  ['comparison/retention.json', 'retention.json'],
  ['comparison/visual-states.json', 'visual-states.json'],
  ['comparison/compatibility.json', 'compatibility.json'],
  ['scheduler-audit-baseline/results.json', 'cpu-paired-baseline.json'],
  ['scheduler-audit-optimized/results.json', 'cpu-paired-optimized.json'],
  ['software-audit-baseline/results.json', 'software-baseline.json'],
  ['software-audit-optimized/results.json', 'software-optimized.json'],
];
for (const [source, destination] of copies) {
  await cp(resolve(root, 'results', source), resolve(out, destination));
}
for (const [source, destination] of [['.benchmark-baseline', 'baseline'], ['.benchmark-dist', 'optimized']]) {
  await cp(resolve(source), resolve(out, 'builds', destination), { recursive: true });
}

const visual = [];
for (const [name, before, after, crop] of [
  ['normal', 'baseline/animated-25.png', 'final-v2/animated-25.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['dense-settled', 'comparison/dense-settled-baseline.png', 'comparison/dense-settled-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['hover', 'comparison/hover-baseline.png', 'comparison/hover-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['group-hover', 'comparison/group-hover-baseline.png', 'comparison/group-hover-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['glyph', 'comparison/glyph-baseline.png', 'comparison/glyph-optimized.png', { x: 40, y: 1390, width: 1250, height: 340 }],
  ['4k', 'baseline/4k-quality-25.png', 'final-v2/4k-quality-25.png', { x: 20, y: 70, width: 1520, height: 350 }],
]) {
  const stats = await screenshotPair(resolve(root, 'results', before), resolve(root, 'results', after),
    resolve(out, `${name}-pair.png`), crop);
  visual.push({ name, before, after, crop, ...stats });
}
// These are original browser PNGs; pair images only crop/copy, never resample or retouch.
await cp(resolve(root, 'results/baseline/animated-25.png'), resolve(out, 'normal-before.png'));
await cp(resolve(root, 'results/final-v2/animated-25.png'), resolve(out, 'normal-after.png'));
await cp(resolve(root, 'results/comparison/animated-25-diff.png'), resolve(out, 'normal-diff-8x.png'));
await writeFile(resolve(out, 'visual.json'), JSON.stringify(visual, null, 2));

const files = await evidenceFiles(out);
await writeFile(resolve(out, 'manifest.json'), JSON.stringify({
  baselineRevision: '79b42b52d807ff4b70d712d01c3f83956e40da8f',
  optimizedState: 'develop working tree; frozen builds identify the actual measured code',
  primaryMeasurementsDate: '2026-10-03', packagedAt: new Date().toISOString(),
  screenshotLayout: 'Left baseline; right optimized. Exact physical-pixel crops, no scaling.',
  files,
}, null, 2));
console.log(`Preserved ${files.length} files (${(files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1)} MiB)`);
