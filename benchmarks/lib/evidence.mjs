import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { PNG } from 'pngjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Exact physical-pixel copies; never scale or alter archived screenshots. */
export async function screenshotPair(beforePath, afterPath, outputPath, crop) {
  const a = PNG.sync.read(await readFile(beforePath));
  const b = PNG.sync.read(await readFile(afterPath));
  const box = crop ?? { x: 0, y: 0, width: a.width, height: a.height };
  if (a.width !== b.width || a.height !== b.height ||
      !Object.values(box).every(Number.isInteger) || box.x < 0 || box.y < 0 ||
      box.width <= 0 || box.height <= 0 ||
      box.x + box.width > a.width || box.y + box.height > a.height) {
    throw new Error(`Invalid screenshot dimensions/crop: ${beforePath}`);
  }
  const pair = new PNG({ width: box.width * 2, height: box.height });
  PNG.bitblt(a, pair, box.x, box.y, box.width, box.height, 0, 0);
  PNG.bitblt(b, pair, box.x, box.y, box.width, box.height, box.width, 0);
  await writeFile(outputPath, PNG.sync.write(pair));
  let changed = 0, max = 0, sum = 0, aboveOne = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const delta = [0, 1, 2].map(channel => Math.abs(a.data[i + channel] - b.data[i + channel]));
    const largest = Math.max(...delta);
    if (largest) changed++;
    if (largest > 1) aboveOne++;
    max = Math.max(max, largest);
    sum += delta[0] + delta[1] + delta[2];
  }
  return { width: a.width, height: a.height, changedPixels: changed,
    changedPercent: changed / (a.width * a.height) * 100, aboveOne, maxChannelDelta: max,
    meanAbsoluteChannelDelta: sum / (a.width * a.height * 3) };
}

/** Inventory without changing measured data, build guards or report metadata. */
export async function evidenceFiles(root) {
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.name !== 'manifest.json') {
        const bytes = await readFile(path);
        files.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: bytes.length,
          sha256: sha256(bytes) });
      }
    }
  }
  await collect(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
