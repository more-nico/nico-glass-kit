import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { cpus, totalmem, platform } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const label = process.argv[2] ?? 'baseline';
const collectedAt = new Date().toISOString();
const repetitions = Number(process.env.BENCH_REPETITIONS ?? 3);
const durationMs = Number(process.env.BENCH_DURATION_MS ?? 5000);
const baseURL = process.env.BENCH_URL ?? 'http://127.0.0.1:4178';
const pairedURL = process.env.BENCH_PAIR_URL;
const out = resolve('benchmarks/results', label);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BENCH_BROWSER_PATH ? { executablePath: process.env.BENCH_BROWSER_PATH } : {}),
  args: ['--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ...(process.env.BENCH_SOFTWARE_GPU === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
});
const browserCDP = await browser.newBrowserCDPSession();
const system = await browserCDP.send('SystemInfo.getInfo');
const cases = [
  { name: 'idle-25', count: 25, mode: 'idle' },
  { name: 'animated-25', count: 25, mode: 'animated' },
  { name: 'dense-100', count: 100, mode: 'animated' },
  { name: '4k-quality-25', count: 25, mode: 'animated', width: 3840, height: 2160, dpr: 1, scale: 0.5 },
  { name: 'cpu6-dense-100', count: 100, mode: 'animated', cpu: 6 },
  { name: 'group-pointer-100', count: 100, mode: 'group' },
  { name: 'resize-25', count: 25, mode: 'resize' },
  { name: 'scroll-250', count: 250, mode: 'scroll' },
  { name: 'medium-100', count: 100, mode: 'animated', quality: 'medium' },
];
const selected = process.env.BENCH_CASES ? cases.filter(c => process.env.BENCH_CASES.split(',').includes(c.name)) : cases;
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
const processCPU = async () => (await browserCDP.send('SystemInfo.getProcessInfo')).processInfo;
const quantile = (a, q) => [...a].sort((a, b) => a - b)[Math.floor((a.length - 1) * q)] ?? 0;
const results = [];
try {
  for (const scene of selected) {
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const variants = pairedURL
        ? (repetition % 2 ? [['optimized', baseURL], ['baseline', pairedURL]] : [['baseline', pairedURL], ['optimized', baseURL]])
        : [['', baseURL]];
      for (const [variant, sceneURL] of variants) {
      const out = resolve('benchmarks/results', variant ? `${label}-${variant}` : label);
      await mkdir(out, { recursive: true });
      const context = await browser.newContext({ viewport: { width: scene.width ?? 1440, height: scene.height ?? 900 }, deviceScaleFactor: scene.dpr ?? 2, colorScheme: 'dark' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: scene.cpu ?? 1 });
      const query = new URLSearchParams({ count: String(scene.count), mode: scene.mode, quality: scene.quality ?? 'high', scale: String(scene.scale ?? 0.2) });
      await page.goto(`${sceneURL}/?${query}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.glassBenchmark?.ready);
      await page.waitForFunction(() => [...document.querySelectorAll('#grid > .ngs-surface .ngs-effect')].every(e => getComputedStyle(e).backdropFilter.includes('url(')));
      const mountMs = await page.evaluate(() => performance.now());
      await page.waitForTimeout(2500);
      const initial = await page.evaluate(() => window.glassBenchmark.stats());
      await page.evaluate(() => window.glassBenchmark.pose());
      if (repetition === 0) await page.screenshot({ path: resolve(out, `${scene.name}.png`), animations: 'disabled' });
      // Warm the exact same workload before the timed sample.
      await page.evaluate(({ mode }) => window.glassBenchmark.measure(1000, mode), scene);
      const before = await metrics(cdp);
      const processes = await processCPU();
      const cpuBefore = new Map(processes.map(p => [p.id, p.cpuTime]));
      let sampler;
      const samplePath = resolve(out, `${scene.name}-${repetition}-windows.json`);
      if (platform() === 'win32') {
        const script = await readFile(resolve('benchmarks/sample-windows.ps1'), 'utf8');
        const quote = s => `'${String(s).replaceAll("'", "''")}'`;
        sampler = spawn('powershell.exe', ['-NoProfile', '-Command', `& {\n${script}\n} -BrowserIds ${quote(processes.map(p => p.id).join(','))} -OutputPath ${quote(samplePath)} -Seconds ${Math.ceil(durationMs / 1000)}`], { windowsHide: true, stdio: 'ignore' });
      }
      const measurement = await page.evaluate(({ durationMs, mode }) => window.glassBenchmark.measure(durationMs, mode), { durationMs, mode: scene.mode });
      const after = await metrics(cdp);
      const cpuAfter = await processCPU();
      const cpuSeconds = cpuAfter.reduce((sum, p) => sum + Math.max(0, p.cpuTime - (cpuBefore.get(p.id) ?? p.cpuTime)), 0);
      let windows = null;
      if (sampler) {
        if (sampler.exitCode === null) await new Promise(r => sampler.once('exit', r));
        try { windows = JSON.parse((await readFile(samplePath, 'utf8')).replace(/^\uFEFF/, '')); } catch { /* unavailable, never invent utilization */ }
      }
      const row = {
        name: scene.name, variant, repetition, conditions: { ...scene, width: scene.width ?? 1440, height: scene.height ?? 900, dpr: scene.dpr ?? 2, scale: scene.scale ?? 0.2 },
        mountMs, fps: measurement.intervals.length / (measurement.elapsedMs / 1000),
        frameP50Ms: quantile(measurement.intervals, 0.5), frameP95Ms: quantile(measurement.intervals, 0.95), frameP99Ms: quantile(measurement.intervals, 0.99),
        longTaskCount: measurement.longTasks.length, longTaskMs: measurement.longTasks.reduce((a, b) => a + b, 0),
        mainThreadBusyPercent: (after.TaskDuration - before.TaskDuration) / (measurement.elapsedMs / 1000) * 100,
        scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
        styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
        browserCPUCorePercent: cpuSeconds / (measurement.elapsedMs / 1000) * 100,
        browserCPUHostPercent: cpuSeconds / (measurement.elapsedMs / 1000) * 100 / cpus().length,
        heapMiB: after.JSHeapUsedSize / 1048576, heapTotalMiB: after.JSHeapTotalSize / 1048576, nodes: after.Nodes,
        initial, final: await page.evaluate(() => window.glassBenchmark.stats()), errors, windows, raw: measurement,
      };
      results.push(row);
      console.log(JSON.stringify({ name: scene.name, variant, repetition, fps: row.fps.toFixed(1), p95: row.frameP95Ms.toFixed(1), busy: row.mainThreadBusyPercent.toFixed(1), heap: row.heapMiB.toFixed(1), mount: mountMs.toFixed(0), errors }));
      await writeFile(resolve(out, 'results.json'), JSON.stringify({ label: variant ? `${label}-${variant}` : label, date: collectedAt.slice(0, 10), collectedAt, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceWorkingTreeDirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()), browser: browser.version(), cpus: cpus()[0].model, logicalCPUs: cpus().length, totalMemoryGiB: totalmem() / 1073741824, gpu: system.gpu, headless: true, repetitions, durationMs, results: results.filter(r => r.variant === variant) }, null, 2));
      await context.close();
      }
    }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${baseURL}/?count=100&mode=group`);
  await page.waitForFunction(() => window.glassBenchmark?.ready);
  await page.waitForTimeout(3000);
  const pixels = await page.evaluate(() => window.glassBenchmark.pixels());
  const churn = await page.evaluate(() => window.glassBenchmark.churn());
  await writeFile(resolve(out, 'stress.json'), JSON.stringify({ pixels, churn }, null, 2));
  console.log('stress', JSON.stringify({ pixels, churn }));
  await context.close();
} finally { await browser.close(); }
