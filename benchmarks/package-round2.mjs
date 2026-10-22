// Archive the exact measured second-round build and unscaled browser pixels.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evidenceFiles, screenshotPair, sha256 } from './lib/evidence.mjs';

const root = resolve('benchmarks');
const out = resolve(root, 'evidence-round2');
const raw = resolve(root, 'results');
const readJSON = async path => JSON.parse(await readFile(resolve(raw, path), 'utf8'));
const before = await readJSON('round2-balanced-baseline/results.json');
const after = await readJSON('round2-balanced-optimized/results.json');
if (before.results.length !== 27 || after.results.length !== 27 ||
  [...before.results, ...after.results].some(r => r.errors.length)) {
  throw Error('Second-round hardware suite must contain 27 error-free samples per variant.');
}
const previousBuild = resolve(root, 'evidence/builds/optimized');
const previousHash = sha256(await readFile(resolve(previousBuild, 'assets/index-BaD-mqQT.js')));
if (previousHash !== '228c4450bbf1c1cc84006a3b706ede3a446357b1dfde695b2b30566d7c8605ff') {
  throw Error('Previous measured build changed.');
}
// The build filename is fixed at collection time; later edits require a new run.
const optimizedHash = sha256(await readFile(resolve('.benchmark-dist/assets/index-Cl4pmo3W.js')));
if (optimizedHash !== 'fab08d806092ae32a4eed70905023ba8a799576e3cf93e9ee77bfda698c41460') {
  throw Error('Second-round measured build changed; collect a new suite before packaging.');
}
const previousCSS = await readFile(resolve(previousBuild, 'assets/index-CzkvtMM8.css'));
if (!previousCSS.equals(await readFile(resolve('.benchmark-dist/assets/index-CzkvtMM8.css')))) {
  throw Error('Measured CSS changed.');
}
await mkdir(out, { recursive: true });
for (const [source, destination] of [
  ['round2-balanced-baseline/results.json', 'previous.json'],
  ['round2-balanced-optimized/results.json', 'optimized.json'],
  ['round2-balanced/stress.json', 'stress.json'],
  ['round2-comparison/summary.json', 'summary.json'],
  ['round2-visual/visual-states.json', 'visual-states.json'],
  ['round2-memory/retention.json', 'retention.json'],
  ['round2-memory/image-retention.json', 'image-retention.json'],
  ['round2-latency/light-latency.json', 'light-latency.json'],
  ['round2-compatibility/compatibility.json', 'compatibility.json'],
  ['glyph-before/glyph.json', 'glyph-before.json'],
  ['glyph-after/glyph.json', 'glyph-after.json'],
  ['round2-software-baseline/results.json', 'software-previous.json'],
  ['round2-software-optimized/results.json', 'software-optimized.json'],
  ['round2-software-comparison/summary.json', 'software-summary.json'],
  ['round2-before/probes.json', 'diagnostic-probes.json'],
  ['round2-before/top.json', 'diagnostic-profile.json'],
]) await cp(resolve(raw, source), resolve(out, destination));
await cp(resolve('.benchmark-dist'), resolve(out, 'build'), { recursive: true });

const visual = [];
for (const [name, previous, optimized, crop] of [
  ['normal', 'round2-balanced-baseline/animated-25.png', 'round2-balanced-optimized/animated-25.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['dense-settled', 'round2-visual/dense-settled-baseline.png', 'round2-visual/dense-settled-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['hover', 'round2-visual/hover-baseline.png', 'round2-visual/hover-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['group-hover', 'round2-visual/group-hover-baseline.png', 'round2-visual/group-hover-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['glyph', 'round2-visual/glyph-baseline.png', 'round2-visual/glyph-optimized.png', { x: 40, y: 1390, width: 1250, height: 340 }],
  ['medium', 'round2-visual/medium-baseline.png', 'round2-visual/medium-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['4k', 'round2-balanced-baseline/4k-quality-25.png', 'round2-balanced-optimized/4k-quality-25.png', { x: 20, y: 70, width: 1520, height: 350 }],
]) {
  const stats = await screenshotPair(resolve(raw, previous), resolve(raw, optimized),
    resolve(out, `${name}-pair.png`), crop);
  visual.push({ name, previous, optimized, crop, ...stats });
}
await cp(resolve(raw, 'round2-balanced-baseline/animated-25.png'), resolve(out, 'normal-before.png'));
await cp(resolve(raw, 'round2-balanced-optimized/animated-25.png'), resolve(out, 'normal-after.png'));
await cp(resolve(raw, 'round2-comparison/animated-25-diff.png'), resolve(out, 'normal-diff-8x.png'));
// Keep the full glyph scene because this run contains a few nonzero pixels.
await cp(resolve(raw, 'round2-visual/glyph-baseline.png'), resolve(out, 'glyph-scene-before.png'));
await cp(resolve(raw, 'round2-visual/glyph-optimized.png'), resolve(out, 'glyph-scene-after.png'));
await writeFile(resolve(out, 'visual.json'), JSON.stringify(visual, null, 2));

const files = await evidenceFiles(out);
await writeFile(resolve(out, 'manifest.json'), JSON.stringify({
  baseline: { path: '../evidence/builds/optimized', jsSha256: previousHash, state: 'Frozen first-round optimized build' },
  optimized: { path: 'build', jsSha256: optimizedHash, state: 'develop working tree at collection' },
  sourceBaseRevision: after.revision, sourceWorkingTreeDirty: after.sourceWorkingTreeDirty,
  measurementsLocalDate: '2026-10-06', timezone: 'Asia/Shanghai',
  collectedAt: after.collectedAt, packagedAt: new Date().toISOString(),
  screenshotLayout: 'Left previous optimized build; right second-round optimized build. Exact physical-pixel crops, no resampling.',
  files,
}, null, 2));
console.log(`Preserved ${files.length} files (${(files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1)} MiB); JS ${optimizedHash}`);
