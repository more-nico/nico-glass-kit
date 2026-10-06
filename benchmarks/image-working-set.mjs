import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const out = resolve('benchmarks/results', process.argv[2] ?? 'review-images');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.BENCH_BROWSER_PATH,
  args: ['--enable-gpu'] });
const results = [];
try {
  for (const [label, url] of [['previous', process.env.BENCH_PAIR_URL ?? 'http://127.0.0.1:4179'],
    ['optimized', process.env.BENCH_URL ?? 'http://127.0.0.1:4178']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
      colorScheme: 'dark' });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}/?count=40&mode=idle`);
    await page.waitForFunction(() => window.glassBenchmark?.ready);
    await page.evaluate(() => {
      document.querySelectorAll('.lines,.orb').forEach(node => node.remove());
      document.getElementById('backdrop').style.background = '#202040';
      document.querySelector('header').style.display = 'none';
      document.querySelector('.ngs-text').style.display = 'none';
      const grid = document.getElementById('grid');
      Object.assign(grid.style, { position: 'relative', gridTemplateColumns: 'repeat(8,100px)', width: '900px' });
      grid.querySelectorAll(':scope > .ngs-surface').forEach(surface => {
        Object.assign(surface.style, { width: '80px', height: '100px' });
        surface.querySelectorAll('.ngs-surface').forEach(nested => { nested.style.display = 'none'; });
      });
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__imageCreates = 0;
      window.Image = new Proxy(window.Image, { construct(target, args) {
        window.__imageCreates++;
        return Reflect.construct(target, args);
      } });
      document.querySelectorAll('#grid > .ngs-surface').forEach((surface, i) => {
        const paint = document.createElement('div');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><metadata>${i}</metadata><rect width="32" height="32" fill="white"/></svg>`;
        Object.assign(paint.style, { position: 'absolute', left: `${surface.offsetLeft}px`, top: `${surface.offsetTop}px`,
          width: `${surface.offsetWidth}px`, height: `${surface.offsetHeight}px`,
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
          backgroundSize: 'cover', backgroundPosition: 'center' });
        surface.before(paint);
      });
    });
    const snapshots = [];
    for (let second = 1; second <= 4; second++) {
      await page.waitForTimeout(1000);
      snapshots.push(await page.evaluate(second => ({ second, privateImageCreates: window.__imageCreates,
        correctlyLit: document.querySelectorAll('#grid > .ngs-surface[data-ngs-light="true"]').length }), second));
    }
    await page.locator('#grid').screenshot({ path: resolve(out, `${label}.png`) });
    const script = await page.evaluate(() => [...document.scripts].find(script => script.type === 'module')?.src);
    const row = { label, script, snapshots, errors };
    results.push(row); console.log(JSON.stringify(row));
    await context.close();
    if (errors.length) throw new Error(`Page errors: ${label}`);
    if (label === 'optimized' && snapshots.some(sample => sample.privateImageCreates !== 40 || sample.correctlyLit !== 40)) {
      throw new Error('Image working set failed to settle');
    }
  }
  await writeFile(resolve(out, 'image-working-set.json'), JSON.stringify({ browser: browser.version(),
    collectedAt: new Date().toISOString(), conditions: { images: 40, imageWidth: 32, imageHeight: 32,
      viewport: { width: 1440, height: 900 }, dpr: 1, quality: 'high', samples: 4, intervalMs: 1000 }, results }, null, 2));
} finally { await browser.close(); }
