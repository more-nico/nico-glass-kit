import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
const beforePath = resolve('benchmarks/results', process.argv[2] ?? 'baseline');
const afterPath = resolve('benchmarks/results', process.argv[3] ?? 'optimized');
const out = resolve('benchmarks/results',process.argv[4]??'comparison');
await mkdir(out, { recursive: true });
const before = JSON.parse(await readFile(resolve(beforePath, 'results.json'), 'utf8'));
const after = JSON.parse(await readFile(resolve(afterPath, 'results.json'), 'utf8'));
for (const field of ['browser','repetitions','durationMs','headless','cpus','logicalCPUs']) {
  if (before[field] !== after[field]) throw Error(`Environment changed: ${field}`);
}
if (before.gpu?.auxAttributes?.glRenderer !== after.gpu?.auxAttributes?.glRenderer) throw Error('GPU backend changed');
const median = a => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const summaries = [];
for (const name of [...new Set(before.results.map(r => r.name))]) {
  const b = before.results.filter(r => r.name === name), a = after.results.filter(r => r.name === name);
  if (!a.length) throw Error(`Missing optimized case ${name}`);
  if (b.length !== before.repetitions || a.length !== after.repetitions) throw Error(`Incomplete samples: ${name}`);
  const conditions = JSON.stringify(b[0].conditions);
  if ([...b, ...a].some(r => JSON.stringify(r.conditions) !== conditions)) throw Error(`Conditions changed: ${name}`);
  if ([...b, ...a].some(r => r.errors.length)) throw Error(`Page error: ${name}`);
  const row = { name, before: {}, after: {} };
  for (const metric of ['fps', 'frameP50Ms', 'frameP95Ms', 'frameP99Ms', 'mountMs', 'mainThreadBusyPercent', 'browserCPUHostPercent', 'heapMiB', 'layoutMs', 'styleMs', 'longTaskCount']) {
    row.before[metric] = median(b.map(r => r[metric])); row.after[metric] = median(a.map(r => r[metric]));
  }
  for (const [metric, field, divisor] of [['workingSetMiB','workingSetBytes',1048576],['gpuPercent','gpuMaxEnginePercent',1],['gpuDedicatedMiB','gpuDedicatedBytes',1048576]]) {
    for (const [key, rows] of [['before',b],['after',a]]) {
      const samples = rows.flatMap(r => r.windows ?? []).map(s => s[field]).filter(x => x !== null && x !== undefined);
      row[key][metric] = samples.length ? median(samples) / divisor : null;
    }
  }
  const bp = PNG.sync.read(await readFile(resolve(beforePath, `${name}.png`))), ap = PNG.sync.read(await readFile(resolve(afterPath, `${name}.png`)));
  if (bp.width !== ap.width || bp.height !== ap.height) throw Error(`Screenshot size changed: ${name}`);
  const diff = new PNG({ width: bp.width, height: bp.height }); let changed = 0, max = 0, total = 0;
  for (let i = 0; i < bp.data.length; i += 4) {
    const d = [0,1,2].map(k => Math.abs(bp.data[i+k] - ap.data[i+k]));
    if (d.some(x => x > 0)) changed++;
    max = Math.max(max, ...d); total += d.reduce((x,y)=>x+y,0);
    diff.data[i] = Math.min(255, d[0]*8); diff.data[i+1] = Math.min(255,d[1]*8); diff.data[i+2] = Math.min(255,d[2]*8); diff.data[i+3] = 255;
  }
  row.visual = { changedPixels: changed, changedPercent: changed / (bp.width*bp.height)*100, maxChannelDelta: max, meanAbsoluteChannelDelta: total/(bp.width*bp.height*3) };
  await writeFile(resolve(out, `${name}-diff.png`), PNG.sync.write(diff));
  const pair = new PNG({ width: bp.width*2, height: bp.height });
  PNG.bitblt(bp, pair, 0, 0, bp.width, bp.height, 0, 0); PNG.bitblt(ap, pair, 0, 0, ap.width, ap.height, bp.width, 0);
  await writeFile(resolve(out, `${name}-pair.png`), PNG.sync.write(pair));
  summaries.push(row);
}
await writeFile(resolve(out, 'summary.json'), JSON.stringify({ before: { browser: before.browser, repetitions: before.repetitions, durationMs: before.durationMs }, after: { browser: after.browser, repetitions: after.repetitions, durationMs: after.durationMs }, summaries }, null, 2));
console.table(summaries.map(r => ({ scene: r.name, FPS: `${r.before.fps.toFixed(1)} → ${r.after.fps.toFixed(1)}`, p95: `${r.before.frameP95Ms.toFixed(1)} → ${r.after.frameP95Ms.toFixed(1)}`, main: `${r.before.mainThreadBusyPercent.toFixed(1)} → ${r.after.mainThreadBusyPercent.toFixed(1)}`, heap: `${r.before.heapMiB.toFixed(1)} → ${r.after.heapMiB.toFixed(1)}`, pixels: r.visual.changedPixels })));
