/** Exercise the published tarball, including the embedded raster Worker. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'vite';
import { chromium } from '@playwright/test';

const root = resolve('.');
const scratch = await realpath(await mkdtemp(join(tmpdir(), 'ngs-package-')));
let browser, server;
try {
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', scratch], { cwd: root, stdio: 'pipe' });
  const tarball = (await readdir(scratch)).find(name => name.endsWith('.tgz'));
  const consumer = join(scratch, 'consumer');
  await mkdir(join(consumer, 'node_modules/nico-glass-kit'), { recursive: true });
  execFileSync('tar', ['-xf', join(scratch, tarball), '--strip-components=1', '-C', join(consumer, 'node_modules/nico-glass-kit')]);
  for (const name of ['react', 'react-dom', 'scheduler']) await symlink(join(root, 'node_modules', name), join(consumer, 'node_modules', name));
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ type: 'module' }));
  for (const [name, source] of [
    ['ssr.cjs', "const React=require('react'); const {renderToString}=require('react-dom/server'); const {GlassRenderGroup,GlassText}=require('nico-glass-kit'); if(!renderToString(React.createElement(GlassRenderGroup,null,React.createElement(GlassText,{text:'Glass2026!'}))).includes('ngs-text'))throw Error('CJS SSR failed');"],
    ['ssr.mjs', "import React from 'react'; import {renderToString} from 'react-dom/server'; import {GlassRenderGroup,GlassText} from 'nico-glass-kit'; if(!renderToString(React.createElement(GlassRenderGroup,null,React.createElement(GlassText,{text:'Glass2026!'}))).includes('ngs-text'))throw Error('ESM SSR failed');"],
  ]) { await writeFile(join(consumer, name), source); execFileSync(process.execPath, [join(consumer, name)], { stdio: 'pipe' }); }
  await writeFile(join(consumer, 'index.html'), '<div id="root"></div><script type="module" src="/main.js"></script>');
  await writeFile(join(consumer, 'main.js'), `import React from 'react'; import {createRoot} from 'react-dom/client'; import {GlassProvider,GlassRenderGroup,GlassSurface,GlassText} from 'nico-glass-kit'; import 'nico-glass-kit/style.css';
const h=React.createElement; const root=createRoot(document.getElementById('root')); let size=80;
window.render=()=>root.render(h(React.StrictMode,null,h(GlassProvider,{quality:'high',overLight:false},h(GlassRenderGroup,null,[0,1,2].map(i=>h(GlassSurface,{key:i,elasticity:0,style:{display:'inline-block',width:180,height:80,margin:8}},i)),h(GlassText,{text:'Glass2026!',fontSize:size,fontFamily:'Arial'})))));
window.resize=()=>{size=96;window.render()}; window.unmount=()=>root.unmount(); window.render();`);
  await build({ root: consumer, configFile: false, logLevel: 'error', build: { outDir: 'build', minify: true } });
  server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    try {
      const file = join(consumer, 'build', path === '/' ? 'index.html' : path);
      const body = await readFile(file);
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.BENCH_BROWSER_PATH, headless: true, args: ['--enable-gpu'] });
  for (const fallback of [false, true]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(fallback => {
      window.__rasterWorkerResults = 0;
      window.__rasterWorkersActive = 0;
      if (fallback) { window.Worker = undefined; return; }
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        live = true;
        constructor(...args) {
          super(...args);
          window.__rasterWorkersActive++;
          this.addEventListener('message', event => { if (event.data?.type === 'done') window.__rasterWorkerResults++; });
        }
        terminate() {
          if (this.live) { this.live = false; window.__rasterWorkersActive--; }
          super.terminate();
        }
      };
    }, fallback);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const exact = () => page.waitForFunction(() => {
      const el = document.querySelector('.ngs-text');
      return el?.hasAttribute('data-ngs-text-ready') && !el.hasAttribute('data-ngs-text-preview') && el.__ngsRaster?.pending === false;
    });
    await exact();
    await page.evaluate(() => window.resize()); await exact();
    const surfaces = await page.locator('.ngs-text-tile[data-ngs-quality="high"]').count();
    if (surfaces !== 10 || errors.length) throw new Error(`Packaged ${fallback ? 'fallback' : 'worker'}: ${surfaces} glyphs; ${errors.join('; ')}`);
    if (!fallback && !(await page.evaluate(() => window.__rasterWorkerResults > 0))) throw new Error('Packaged worker path never delivered an actual result');
    await page.evaluate(() => window.unmount());
    if (await page.locator('filter, .ngs-render-layer').count()) throw new Error('Packaged filters retained after unmount');
    if (await page.evaluate(() => window.__rasterWorkersActive !== 0)) throw new Error('Packaged workers retained after unmount');
    await context.close();
  }
  console.log('Package smoke passed: tarball ESM/CJS SSR, production consumer, Worker/fallback, resize and cleanup.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
