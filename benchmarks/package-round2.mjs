// Archive the exact measured second-round build and unscaled browser pixels.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { PNG } from 'pngjs';

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
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const previousBuild = resolve(root, 'evidence/builds/optimized');
const previousHash = sha(await readFile(resolve(previousBuild, 'assets/index-BaD-mqQT.js')));
if (previousHash !== '228c4450bbf1c1cc84006a3b706ede3a446357b1dfde695b2b30566d7c8605ff') {
  throw Error('Previous measured build changed.');
}
// The build filename is fixed at collection time; later edits require a new run.
const optimizedHash = sha(await readFile(resolve('.benchmark-dist/assets/index-Cl4pmo3W.js')));
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
  const a = PNG.sync.read(await readFile(resolve(raw, previous)));
  const b = PNG.sync.read(await readFile(resolve(raw, optimized)));
  if (a.width !== b.width || a.height !== b.height || crop.x + crop.width > a.width || crop.y + crop.height > a.height) {
    throw Error(`Invalid screenshot dimensions: ${name}`);
  }
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
    max = Math.max(max, largest); sum += delta[0] + delta[1] + delta[2];
  }
  visual.push({ name, previous, optimized, crop, width: a.width, height: a.height,
    changedPixels: changed, changedPercent: changed / (a.width * a.height) * 100,
    aboveOne, maxChannelDelta: max, meanAbsoluteChannelDelta: sum / (a.width * a.height * 3) });
}
await cp(resolve(raw, 'round2-balanced-baseline/animated-25.png'), resolve(out, 'normal-before.png'));
await cp(resolve(raw, 'round2-balanced-optimized/animated-25.png'), resolve(out, 'normal-after.png'));
await cp(resolve(raw, 'round2-comparison/animated-25-diff.png'), resolve(out, 'normal-diff-8x.png'));
// Keep the full glyph scene because this run contains a few nonzero pixels.
await cp(resolve(raw, 'round2-visual/glyph-baseline.png'), resolve(out, 'glyph-scene-before.png'));
await cp(resolve(raw, 'round2-visual/glyph-optimized.png'), resolve(out, 'glyph-scene-after.png'));
await writeFile(resolve(out, 'visual.json'), JSON.stringify(visual, null, 2));

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.name !== 'manifest.json') {
      const bytes = await readFile(path);
      files.push({ path: relative(out, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) });
    }
  }
}
await collect(out);
await writeFile(resolve(out, 'manifest.json'), JSON.stringify({
  baseline: { path: '../evidence/builds/optimized', jsSha256: previousHash, state: 'Frozen first-round optimized build' },
  optimized: { path: 'build', jsSha256: optimizedHash, state: 'develop working tree at collection' },
  sourceBaseRevision: after.revision, sourceWorkingTreeDirty: after.sourceWorkingTreeDirty,
  measurementsLocalDate: '2026-10-06', timezone: 'Asia/Shanghai',
  collectedAt: after.collectedAt, packagedAt: new Date().toISOString(),
  screenshotLayout: 'Left previous optimized build; right second-round optimized build. Exact physical-pixel crops, no resampling.',
  files: files.sort((a, b) => a.path.localeCompare(b.path)),
}, null, 2));
console.log(`Preserved ${files.length} files (${(files.reduce((s, f) => s + f.bytes, 0) / 1048576).toFixed(1)} MiB); JS ${optimizedHash}`);
