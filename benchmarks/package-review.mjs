import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
import { PNG } from 'pngjs';

const raw = resolve('benchmarks/results'), out = resolve('benchmarks/evidence-review');
const sha = data => createHash('sha256').update(data).digest('hex');
const jsName = 'index-DmA9kUn9.js';
const expected = 'b93c3d1dcee8e136532c379c95caee3e7bc4ae1171a634f43bf2072e6e6af21f';
if (sha(await readFile(resolve('.benchmark-dist/assets', jsName))) !== expected) {
  throw new Error('Review build changed; do not overwrite the archived experiment');
}
const before = JSON.parse(await readFile(resolve(raw, 'review-final-baseline/results.json')));
const after = JSON.parse(await readFile(resolve(raw, 'review-final-optimized/results.json')));
for (const data of [before, after]) {
  if (data.results.length !== 9 || data.results.some(row => row.errors.length)) throw new Error('Incomplete review measurements');
}
await mkdir(out, { recursive: true });
await cp(resolve('.benchmark-dist'), resolve(out, 'build'), { recursive: true });
for (const [from, to] of [
  ['review-final-baseline/results.json', 'previous.json'],
  ['review-final-optimized/results.json', 'optimized.json'],
  ['review-final-comparison/summary.json', 'summary.json'],
  ['review-final/stress.json', 'stress.json'],
  ['review-visual/visual-states.json', 'visual-states.json'],
  ['review-memory/image-retention.json', 'image-retention.json'],
  ['review-compatibility/compatibility.json', 'compatibility.json'],
  ['review-images/image-working-set.json', 'image-working-set.json'],
  ['review-images/previous.png', 'image-working-set-before.png'],
  ['review-images/optimized.png', 'image-working-set-after.png'],
  ['review-visual/medium-baseline.png', 'medium-before.png'],
  ['review-visual/medium-optimized.png', 'medium-after.png'],
  ['review-final-baseline/idle-25.png', 'normal-before.png'],
  ['review-final-optimized/idle-25.png', 'normal-after.png'],
]) await cp(resolve(raw, from), resolve(out, to));
for (const [name, aPath, bPath, crop] of [
  ['normal', 'review-final-baseline/idle-25.png', 'review-final-optimized/idle-25.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['4k', 'review-final-baseline/4k-quality-25.png', 'review-final-optimized/4k-quality-25.png', { x: 20, y: 70, width: 1520, height: 350 }],
  ['medium', 'review-visual/medium-baseline.png', 'review-visual/medium-optimized.png', { x: 40, y: 150, width: 1100, height: 700 }],
  ['image-working-set', 'review-images/previous.png', 'review-images/optimized.png', null],
]) {
  const a = PNG.sync.read(await readFile(resolve(raw, aPath))), b = PNG.sync.read(await readFile(resolve(raw, bPath)));
  const box = crop ?? { x: 0, y: 0, width: a.width, height: a.height };
  if (a.width !== b.width || a.height !== b.height || box.x + box.width > a.width || box.y + box.height > a.height) {
    throw new Error(`Invalid screenshot crop: ${name}`);
  }
  const pair = new PNG({ width: box.width * 2, height: box.height });
  PNG.bitblt(a, pair, box.x, box.y, box.width, box.height, 0, 0);
  PNG.bitblt(b, pair, box.x, box.y, box.width, box.height, box.width, 0);
  await writeFile(resolve(out, `${name}-pair.png`), PNG.sync.write(pair));
}
const files = [];
async function inventory(dir) {
  for (const name of await readdir(dir)) {
    const path = resolve(dir, name), info = await stat(path);
    if (info.isDirectory()) await inventory(path);
    else if (name !== 'manifest.json') files.push({ path: relative(out, path).replaceAll('\\', '/'),
      bytes: info.size, sha256: sha(await readFile(path)) });
  }
}
await inventory(out);
await writeFile(resolve(out, 'manifest.json'), JSON.stringify({
  previous: { path: '../evidence-round2/build', jsSha256: 'fab08d806092ae32a4eed70905023ba8a799576e3cf93e9ee77bfda698c41460' },
  optimized: { path: 'build', jsSha256: expected }, sourceBaseRevision: before.revision,
  sourceWorkingTreeDirty: true, collectedAt: after.collectedAt, packagedAt: new Date().toISOString(),
  screenshotLayout: 'Left frozen second-round build; right source after review. Physical-pixel crops, no resampling.',
  files,
}, null, 2));
console.log(`Packaged ${files.length} files into ${out}`);
