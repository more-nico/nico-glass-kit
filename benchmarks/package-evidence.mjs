// Preserve measured data and unscaled screenshot crops without rebuilding either fixture.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { PNG } from 'pngjs';

const root = resolve('benchmarks');
const out = resolve(root, 'evidence');
// This packages the archived first experiment, never a later working tree.
// Refuse before touching evidence if the build no longer matches that run.
const firstRoundHash = '228c4450bbf1c1cc84006a3b706ede3a446357b1dfde695b2b30566d7c8605ff';
const measuredJS = await readFile(resolve('.benchmark-dist/assets/index-BaD-mqQT.js'));
if (createHash('sha256').update(measuredJS).digest('hex') !== firstRoundHash) {
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
  const a = PNG.sync.read(await readFile(resolve(root, 'results', before)));
  const b = PNG.sync.read(await readFile(resolve(root, 'results', after)));
  if (a.width !== b.width || a.height !== b.height) throw Error(`Size changed: ${name}`);
  const pair = new PNG({ width: crop.width * 2, height: crop.height });
  PNG.bitblt(a, pair, crop.x, crop.y, crop.width, crop.height, 0, 0);
  PNG.bitblt(b, pair, crop.x, crop.y, crop.width, crop.height, crop.width, 0);
  await writeFile(resolve(out, `${name}-pair.png`), PNG.sync.write(pair));
  let changed = 0, max = 0, sum = 0, aboveOne = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = [0, 1, 2].map(k => Math.abs(a.data[i + k] - b.data[i + k]));
    const largest = Math.max(...delta);
    if (largest) changed++;
    if (largest > 1) aboveOne++;
    max = Math.max(max, largest); sum += delta.reduce((x, y) => x + y, 0);
  }
  visual.push({ name, before, after, crop, width: a.width, height: a.height, changedPixels: changed,
    changedPercent: changed / (a.width * a.height) * 100, aboveOne, maxChannelDelta: max,
    meanAbsoluteChannelDelta: sum / (a.width * a.height * 3) });
}
// These are original browser PNGs; pair images only crop/copy, never resample or retouch.
await cp(resolve(root, 'results/baseline/animated-25.png'), resolve(out, 'normal-before.png'));
await cp(resolve(root, 'results/final-v2/animated-25.png'), resolve(out, 'normal-after.png'));
await cp(resolve(root, 'results/comparison/animated-25-diff.png'), resolve(out, 'normal-diff-8x.png'));
await writeFile(resolve(out, 'visual.json'), JSON.stringify(visual, null, 2));

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name !== 'manifest.json') {
      const bytes = await readFile(path);
      files.push({ path: relative(out, path).replaceAll('\\', '/'), bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await collect(out);
await writeFile(resolve(out, 'manifest.json'), JSON.stringify({
  baselineRevision: '79b42b52d807ff4b70d712d01c3f83956e40da8f',
  optimizedState: 'develop working tree; frozen builds identify the actual measured code',
  primaryMeasurementsDate: '2026-10-03', packagedAt: new Date().toISOString(),
  screenshotLayout: 'Left baseline; right optimized. Exact physical-pixel crops, no scaling.',
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2));
console.log(`Preserved ${files.length} files (${(files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1)} MiB)`);
