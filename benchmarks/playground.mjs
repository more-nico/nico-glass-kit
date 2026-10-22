#!/usr/bin/env node
/** Optional production-playground scroll benchmark. Never part of test:release. */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { resolve, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fetchBuildMetadata } from './lib/buildMetadata.mjs';
import { NATIVE_SCROLL_SEQUENCE, evaluateSequence, parseTrace } from './lib/presentation.mjs';

const env = process.env;
const truthy = value => /^(1|true|yes|on)$/i.test(String(value ?? ''));
const number = (name, fallback) => env[name] === undefined ? fallback : Number(env[name]);
const BASE_URL = env.BENCH_URL || 'http://127.0.0.1:4190';
const PAIR_URL = env.BENCH_PAIR_URL;
const BROWSER_PATH = env.BENCH_BROWSER_PATH;
const HEADLESS = truthy(env.BENCH_HEADLESS);
const FULLSCREEN = truthy(env.BENCH_FULLSCREEN);
const WINDOW_LEFT = number('BENCH_WINDOW_LEFT', NaN);
const WINDOW_TOP = number('BENCH_WINDOW_TOP', 25);
const EXPECT_DPR = number('BENCH_EXPECT_DPR', NaN);
const VIEWPORT_WIDTH = number('BENCH_VIEWPORT_WIDTH', NaN);
const VIEWPORT_HEIGHT = number('BENCH_VIEWPORT_HEIGHT', NaN);
const FIXED_VIEWPORT = Number.isFinite(VIEWPORT_WIDTH) && Number.isFinite(VIEWPORT_HEIGHT);
if (Number.isFinite(VIEWPORT_WIDTH) !== Number.isFinite(VIEWPORT_HEIGHT) ||
    (FIXED_VIEWPORT && (HEADLESS || FULLSCREEN || VIEWPORT_WIDTH < 320 || VIEWPORT_HEIGHT < 240))) {
  throw new Error('Supply both viewport dimensions for a headed, non-fullscreen native window');
}
const REQUESTED_WINDOW = FIXED_VIEWPORT ? `windowed-${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}`
  : FULLSCREEN ? 'fullscreen' : 'maximized';
const ROUNDS = number('BENCH_ROUNDS', 5);
const DURATION_MS = number('BENCH_DURATION_MS', 20000);
if (!Number.isInteger(ROUNDS) || ROUNDS < 1 || !Number.isFinite(DURATION_MS) || DURATION_MS <= 0) {
  throw new Error('BENCH_ROUNDS must be a positive integer; BENCH_DURATION_MS must be positive');
}
const BACKGROUNDS = ['night', 'aurora', 'sunset', 'ocean', 'text'];
const BACKGROUND = env.BENCH_BACKGROUND || 'night';
if (!BACKGROUNDS.includes(BACKGROUND)) throw new Error(`Unknown background: ${BACKGROUND}`);
const LABEL = safeName(env.BENCH_LABEL || 'playground-scroll');
const SCROLL_ACTION = 'native-scroll';
const GZIP_TRACE = true;
const TRACE_CATEGORIES = ['benchmark', 'cc', 'viz', 'gpu', 'devtools.timeline', 'blink.user_timing'];
await mkdir(resolve('benchmarks/results'), { recursive: true });
const OUT_ROOT = await createOutputDirectory();
const diagnostic = HEADLESS || ROUNDS < 5 || DURATION_MS < 20000;

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

async function createOutputDirectory() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const base = resolve('benchmarks', 'results', `${LABEL}-${stamp}`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    try {
      await mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Could not create a new results directory under benchmarks/results (${base})`);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeToRoot(path) {
  return relative(OUT_ROOT, path).replaceAll('\\', '/');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readSourceMetadata() {
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const porcelain = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    return {
      revision,
      dirty: porcelain.length > 0,
      statusPorcelain: porcelain,
      error: null,
    };
  } catch (error) {
    return {
      revision: null,
      dirty: null,
      statusPorcelain: null,
      error: error.message,
    };
  }
}

function metricMap(payload) {
  return Object.fromEntries((payload?.metrics ?? []).map(metric => [metric.name, metric.value]));
}

function metricDelta(before, after, name, scale = 1) {
  const a = before?.[name];
  const b = after?.[name];
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) * scale : null;
}

function summarizeIntervals(intervals) {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return {
      count: null,
      fps: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      maxMs: null,
      over25ms: null,
      over33ms: null,
      over25Ratio: null,
      over33Ratio: null,
      elapsedMs: null,
    };
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const sum = intervals.reduce((total, value) => total + value, 0);
  const quantile = q => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
  const over25 = intervals.filter(value => value > 25).length;
  const over33 = intervals.filter(value => value > 33.4).length;
  return {
    count: intervals.length,
    fps: sum > 0 ? (intervals.length * 1000) / sum : null,
    p50Ms: quantile(0.5),
    p95Ms: quantile(0.95),
    p99Ms: quantile(0.99),
    maxMs: sorted[sorted.length - 1],
    over25ms: over25,
    over33ms: over33,
    over25Ratio: over25 / intervals.length,
    over33Ratio: over33 / intervals.length,
    elapsedMs: sum,
  };
}

function median(values) {
  const finite = values.filter(value => Number.isFinite(value));
  if (!finite.length) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function applyRangeValue(locator, value) {
  return locator.evaluate((element, nextValue) => {
    const input = element instanceof HTMLInputElement ? element : element.querySelector('input');
    if (!input) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, String(nextValue));
    else input.value = String(nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value;
  }, value);
}

async function clickRadio(page, scopeSelector, label) {
  const scope = page.locator(scopeSelector).first();
  const radio = scope.getByRole('radio', { name: label, exact: true });
  if (await radio.count()) {
    await radio.first().click();
    return true;
  }
  return false;
}

async function resetPageScroll(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    const body = document.querySelector('.cp-card .ngs-card-body');
    if (body) body.scrollTop = 0;
  });
  await page.waitForTimeout(80);
}

async function pickPageScrollPoint(page) {
  return page.evaluate(() => {
    const scrollableAncestor = (start) => {
      for (let node = start; node; node = node.parentElement) {
        if (node === document.body || node === document.documentElement) break;
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
          return node;
        }
      }
      return null;
    };
    const cp = document.querySelector('.cp');
    const cpRect = cp?.getBoundingClientRect();
    const gallery = document.querySelector('.pg-gallery');
    const galleryRect = gallery?.getBoundingClientRect();
    const y = Math.max(90, Math.min(Math.round(innerHeight * 0.55), innerHeight - 24));
    const candidates = [{ x: 8, anchor: 'page-left-edge' }];
    if (cpRect && galleryRect) {
      const gap = cpRect.left - galleryRect.right;
      if (gap > 16) {
        candidates.push({ x: Math.round(galleryRect.right + gap / 2), anchor: 'gallery-cp-gap' });
      }
      if (cpRect.left > 24) {
        candidates.push({ x: Math.round(cpRect.left - 12), anchor: 'before-control-panel' });
      }
    }
    for (const candidate of candidates) {
      if (candidate.x < 1 || candidate.x >= innerWidth) continue;
      const element = document.elementFromPoint(candidate.x, y);
      if (!scrollableAncestor(element)) {
        return { x: candidate.x, y, anchor: candidate.anchor };
      }
    }
    // The left gutter must not be inside a nested scroller. If every candidate
    // is rejected, fail loudly rather than silently measuring that scroller.
    const fallback = document.elementFromPoint(8, y);
    return {
      x: 8,
      y,
      anchor: 'fallback-left-edge',
      nestedScroller: Boolean(scrollableAncestor(fallback)),
    };
  });
}

async function pageScrollAction(page, cdp, deadline, options) {
  const speed = options.speed ?? 3000;
  const distance = options.distance ?? 2400;
  const point = await pickPageScrollPoint(page);
  if (point.nestedScroller) {
    throw new Error('could not find a page-level wheel target outside nested scrollers');
  }
  let down = true;
  let gestures = 0;
  let moved = false;
  const initial = await page.evaluate(() => window.scrollY);
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => ({
      y: window.scrollY,
      max: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }));
    if (state.max < 10) throw new Error('playground page is not scrollable');
    if (state.y >= state.max - 2) down = false;
    if (state.y <= 2) down = true;
    const available = down ? state.max - state.y : state.y;
    if (available < 20) {
      down = !down;
      continue;
    }
    const amount = Math.min(distance, available);
    const before = await page.evaluate(() => window.scrollY);
    await cdp.send('Input.synthesizeScrollGesture', {
      x: point.x,
      y: point.y,
      yDistance: down ? -amount : amount,
      speed,
      gestureSourceType: 'mouse',
      preventFling: true,
    });
    const after = await page.evaluate(() => window.scrollY);
    if ((down && after <= before + 0.5) || (!down && after >= before - 0.5)) {
      throw new Error(
        `native wheel gesture did not move window.scrollY ${down ? 'down' : 'up'} ` +
        `(${before} -> ${after}, point x=${point.x}, anchor=${point.anchor}); ` +
        'the target fell into a nested scroller or the page is stuck',
      );
    }
    gestures += 1;
    if (Math.abs(after - initial) > 4) moved = true;
  }
  return { action: SCROLL_ACTION, gestures, moved, speed, distance, scrollPoint: point };
}

async function startRafSampler(page) {
  await page.evaluate(() => {
    const state = {
      intervals: [],
      longTasks: [],
      startedAt: performance.now(),
      last: 0,
      raf: 0,
      observer: null,
      contentObserver: null,
      visibleText: new Set(),
      contentFrames: 0,
      incompleteTextFrames: 0,
    };
    state.contentObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) state.visibleText.add(entry.target);
        else state.visibleText.delete(entry.target);
      }
    });
    for (const text of document.querySelectorAll('.ngs-text')) state.contentObserver.observe(text);
    try {
      state.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
        }
      });
      state.observer.observe({ type: 'longtask' });
    } catch {
      state.observer = null;
    }
    const tick = time => {
      state.contentFrames++;
      if ([...state.visibleText].some(text => !text.hasAttribute('data-ngs-text-ready'))) state.incompleteTextFrames++;
      if (state.last) {
        const delta = time - state.last;
        if (delta > 0) state.intervals.push(delta);
      }
      state.last = time;
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
    window.__glassBenchRaf = state;
  });
}

async function stopRafSampler(page) {
  return page.evaluate(() => {
    const state = window.__glassBenchRaf;
    if (!state) {
      return {
        intervals: [],
        longTasks: [],
        elapsedMs: null,
      };
    }
    cancelAnimationFrame(state.raf);
    state.observer?.disconnect();
    state.contentObserver?.disconnect();
    return {
      intervals: state.intervals,
      longTasks: state.longTasks,
      elapsedMs: performance.now() - state.startedAt,
      content: { frames: state.contentFrames, incompleteTextFrames: state.incompleteTextFrames },
    };
  });
}

async function startTrace(cdp) {
  const events = [];
  let resolveComplete;
  const complete = new Promise(resolvePromise => {
    resolveComplete = resolvePromise;
  });
  const onData = payload => {
    if (Array.isArray(payload.value)) events.push(...payload.value);
  };
  cdp.on('Tracing.dataCollected', onData);
  cdp.once('Tracing.tracingComplete', () => resolveComplete());
  cdp.once('Tracing.tracingComplete', () => {
    cdp.off('Tracing.dataCollected', onData);
  });
  try {
    await cdp.send('Tracing.start', {
      traceConfig: {
        includedCategories: TRACE_CATEGORIES,
        excludedCategories: [],
        recordMode: 'recordAsMuchAsPossible',
      },
      transferMode: 'ReportEvents',
    });
  } catch (error) {
    cdp.off('Tracing.dataCollected', onData);
    throw error;
  }
  let stopped = false;
  return {
    events,
    async stop() {
      if (stopped) return events;
      stopped = true;
      let timeoutId;
      const timeout = new Promise((_, rejectPromise) => {
        timeoutId = setTimeout(() => rejectPromise(new Error('Timed out waiting for Tracing.tracingComplete')), 30000);
      });
      try {
        await cdp.send('Tracing.end');
        await Promise.race([complete, timeout]);
      } finally { clearTimeout(timeoutId); }
      return events;
    },
  };
}

async function auditHighSurfaces(page) {
  return page.evaluate(() => {
    const filters = new Map();
    for (const node of document.querySelectorAll('svg filter[id]')) {
      filters.set(node.id, node);
    }
    const filterFromBackdrop = (value) => {
      if (!value) return null;
      const match = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(value);
      return match ? match[1] : null;
    };
    const groupInfo = (surface) => {
      const group = surface.closest('.ngs-render-group');
      if (!group) {
        return { present: false, batches: 0, members: 0, layers: 0, activeLayers: 0, active: false };
      }
      const batches = Number(group.dataset.ngsRenderBatches ?? 0);
      const members = Number(group.dataset.ngsRenderMembers ?? 0);
      const effect = surface.querySelector(':scope > .ngs-motion > .ngs-effect');
      const layers = [...group.querySelectorAll(':scope > .ngs-render-host > .ngs-render-layer')];
      const activeLayers = layers.filter(layer => {
        const style = getComputedStyle(layer);
        const id = filterFromBackdrop(style.backdropFilter || style.webkitBackdropFilter);
        return Boolean(id && filters.get(id)?.isConnected && id === effect?.__ngsBatchFilter &&
          style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0);
      });
      return {
        present: true,
        batches,
        members,
        layers: layers.length,
        activeLayers: activeLayers.length,
        active: batches > 0 && members > 0 && activeLayers.length > 0,
      };
    };

    const high = [...document.querySelectorAll('[data-ngs-quality="high"]')];
    const invalid = [];
    let valid = 0;
    let batched = 0;
    let individual = 0;
    let lowFallback = 0;
    high.forEach((surface, index) => {
      const identity = {
        index,
        tag: surface.tagName.toLowerCase(),
        id: surface.id || null,
        className: typeof surface.className === 'string' ? surface.className.slice(0, 160) : null,
      };
      const effect = surface.querySelector('.ngs-effect');
      if (!effect) {
        invalid.push({ ...identity, reason: 'missing .ngs-effect' });
        return;
      }
      const style = getComputedStyle(effect);
      const backdrop = style.backdropFilter || style.webkitBackdropFilter || 'none';
      const filterId = filterFromBackdrop(backdrop);
      const isBatched = effect.dataset.ngsRenderBatched === 'true';
      const groups = groupInfo(surface);
      if (isBatched) {
        if (backdrop !== 'none') {
          lowFallback += 1;
          invalid.push({
            ...identity,
            reason: 'batched effect still paints a private backdrop chain',
            backdrop,
            batched: true,
            group: groups,
          });
          return;
        }
        if (!groups.present || !groups.active) {
          invalid.push({
            ...identity,
            reason: 'batched surface has no active shared render group/layer',
            backdrop,
            batched: true,
            group: groups,
          });
          return;
        }
        batched += 1;
        valid += 1;
        return;
      }
      if (!filterId) {
        lowFallback += 1;
        invalid.push({
          ...identity,
          reason: 'high surface effect is not url(#filter)',
          backdrop,
          batched: false,
          group: groups,
        });
        return;
      }
      const filter = filters.get(filterId);
      if (!filter || !filter.isConnected) {
        invalid.push({
          ...identity,
          reason: `referenced SVG filter #${filterId} is missing`,
          backdrop,
          batched: false,
          filterId,
          group: groups,
        });
        return;
      }
      individual += 1;
      valid += 1;
    });
    return {
      total: high.length,
      valid,
      invalidCount: invalid.length,
      batched,
      individual,
      lowFallback,
      filters: filters.size,
      renderGroups: [...document.querySelectorAll('.ngs-render-group')].map(group => ({
        className: group.className,
        batches: Number(group.dataset.ngsRenderBatches ?? 0),
        members: Number(group.dataset.ngsRenderMembers ?? 0),
      })),
      pass: high.length > 0 && invalid.length === 0,
      invalid: invalid.slice(0, 24),
    };
  });
}

async function collectPageEnvironment(page) {
  const runtime = await page.evaluate(() => {
    let webgl = null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        webgl = {
          vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
          renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
        };
      }
    } catch {
      webgl = null;
    }
    return {
      href: location.href,
      scripts: [...document.scripts].map(script => script.src).filter(Boolean),
      userAgent: navigator.userAgent,
      language: navigator.language,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      screenX: window.screenX,
      screenY: window.screenY,
      devicePixelRatio: window.devicePixelRatio,
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        availWidth: window.screen.availWidth,
        availHeight: window.screen.availHeight,
        colorDepth: window.screen.colorDepth,
        pixelDepth: window.screen.pixelDepth,
      },
      webgl,
      isViteDevClient: [...document.scripts].some(script => /\/@vite\/client/.test(script.src)),
    };
  });
  // The environment says High only after every High surface's actual effect
  // has been checked; a label alone is not accepted.
  runtime.highSurfaces = await auditHighSurfaces(page);
  return runtime;
}

function publicGpu(systemInfo) {
  const gpu = systemInfo?.gpu;
  if (!gpu) return null;
  return {
    devices: gpu.devices ?? null,
    featureStatus: gpu.featureStatus ?? null,
    driverBugWorkarounds: gpu.driverBugWorkarounds ?? null,
    auxAttributes: gpu.auxAttributes ?? null,
  };
}

async function writeTraceArtifact(sampleDir, events) {
  const raw = JSON.stringify({ traceEvents: events });
  const fileName = GZIP_TRACE ? 'trace.json.gz' : 'trace.json';
  const path = resolve(sampleDir, fileName);
  const bytes = GZIP_TRACE ? gzipSync(raw) : Buffer.from(raw, 'utf8');
  await writeFile(path, bytes);
  return {
    path: relativeToRoot(path),
    categoryCount: events.length,
    bytes: bytes.length,
    sha256: sha256(bytes),
    encoding: GZIP_TRACE ? 'gzip' : 'json',
    eventCount: events.length,
  };
}

async function configureWindow(page, context) {
  if (!HEADLESS && (FULLSCREEN || FIXED_VIEWPORT || Number.isFinite(WINDOW_LEFT))) {
    const windowCDP = await context.newCDPSession(page);
    const { targetInfo } = await windowCDP.send('Target.getTargetInfo');
    const { windowId } = await windowCDP.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
    if (FIXED_VIEWPORT || Number.isFinite(WINDOW_LEFT)) {
      await windowCDP.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await windowCDP.send('Browser.setWindowBounds', { windowId, bounds: {
        left: Number.isFinite(WINDOW_LEFT) ? WINDOW_LEFT : 0, top: WINDOW_TOP,
        width: FIXED_VIEWPORT ? VIEWPORT_WIDTH : 1600,
        height: FIXED_VIEWPORT ? VIEWPORT_HEIGHT : 900,
      } });
    }
    if (FIXED_VIEWPORT) {
      // Adjust the real OS window for browser chrome. Never override device
      // metrics: DPR and physical rendering remain those of the chosen screen.
      for (let attempt = 0; attempt < 4; attempt++) {
        await page.waitForTimeout(250);
        const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        if (size.width === VIEWPORT_WIDTH && size.height === VIEWPORT_HEIGHT) break;
        const { bounds } = await windowCDP.send('Browser.getWindowBounds', { windowId });
        await windowCDP.send('Browser.setWindowBounds', { windowId, bounds: {
          width: bounds.width + VIEWPORT_WIDTH - size.width,
          height: bounds.height + VIEWPORT_HEIGHT - size.height,
        } });
      }
    } else {
      await windowCDP.send('Browser.setWindowBounds', { windowId, bounds: { windowState: FULLSCREEN ? 'fullscreen' : 'maximized' } });
    }
    await windowCDP.detach();
  }
}

async function prepare(page) {
  await page.locator('.cp-card').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  if (await page.locator('script[src*="/@vite/client"]').count()) throw new Error('Use a production playground build');
  for (const [scope, name] of [['.cp-seg-control:not(.cp-seg-control--stack)', 'High'], ['.cp-seg-control--stack', 'Auto']]) {
    if (!await clickRadio(page, scope, name)) throw new Error(`Missing ${name} control`);
  }
  let scale = page.locator('[data-testid="control-mapScale"]');
  if (!await scale.count()) scale = page.locator('input[type="range"][step="0.05"][max="0.5"]');
  await applyRangeValue(scale.first(), 0.5);
  const value = await scale.first().evaluate(el => (el instanceof HTMLInputElement ? el : el.querySelector('input'))?.value);
  if (Number(value) !== 0.5) throw new Error('Map scale did not reach 0.5');
  await page.locator('.cp-bgs .cp-bg-btn').nth(BACKGROUNDS.indexOf(BACKGROUND)).click();
  await page.mouse.move(8, 100);
  await resetPageScroll(page);
  await page.waitForTimeout(2500);
}

async function sample(browser, variant, round, order) {
  const dir = resolve(OUT_ROOT, variant.id, `round-${round}`);
  await mkdir(dir, { recursive: true });
  const result = { variant, round, order, startedAt: new Date().toISOString(), status: 'error', errors: [] };
  let context, trace, traceCDP;
  try {
    context = await browser.newContext({ viewport: null, locale: 'en-US', colorScheme: 'dark',
      ...(truthy(env.BENCH_RECORD_VIDEO) ? { recordVideo: { dir: resolve(dir, 'video') } } : {}) });
    await context.addInitScript(() => { try { localStorage.setItem('nico-glass-kit:lang', 'en'); } catch {} });
    const page = await context.newPage();
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
    page.on('requestfailed', request => result.errors.push(`${request.url()}: ${request.failure()?.errorText}`));
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
    await configureWindow(page, context);
    await page.goto(variant.url, { waitUntil: 'load', timeout: 60000 });
    await prepare(page);
    result.environment = await collectPageEnvironment(page);
    const view = result.environment;
    if (Number.isFinite(EXPECT_DPR) && view.devicePixelRatio !== EXPECT_DPR) throw new Error(`Wrong native DPR: ${view.devicePixelRatio}`);
    if (FIXED_VIEWPORT && (view.innerWidth !== VIEWPORT_WIDTH || view.innerHeight !== VIEWPORT_HEIGHT)) throw new Error(`Wrong native viewport: ${view.innerWidth}x${view.innerHeight}`);
    if (!view.highSurfaces.pass) throw new Error('High validation failed before measurement');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    const before = metricMap(await cdp.send('Performance.getMetrics'));
    traceCDP = await browser.newBrowserCDPSession();
    trace = await startTrace(traceCDP);
    await startRafSampler(page);
    const start = Date.now();
    result.action = await pageScrollAction(page, cdp, start + DURATION_MS, { speed: 3000, distance: 2400 });
    result.actionMs = Date.now() - start;
    const raf = await stopRafSampler(page);
    result.jsraf = { ...summarizeIntervals(raf.intervals), content: raf.content };
    const after = metricMap(await cdp.send('Performance.getMetrics'));
    result.mainThread = { taskDurationMs: metricDelta(before, after, 'TaskDuration', 1000),
      scriptDurationMs: metricDelta(before, after, 'ScriptDuration', 1000),
      layoutDurationMs: metricDelta(before, after, 'LayoutDuration', 1000), longTasks: raf.longTasks };
    await page.waitForTimeout(700);
    result.highSurfaces = { before: view.highSurfaces, after: await auditHighSurfaces(page) };
    await page.screenshot({ path: resolve(dir, 'screenshot.png'), animations: 'disabled' });
    await writeJson(resolve(dir, 'raf.json'), raf);
    if (page.video()) result.video = relativeToRoot(await page.video().path());
  } catch (error) {
    result.errors.push(safeErrorMessage(error));
  } finally {
    // Renderer teardown flushes sequence counters. Keep tracing on the browser
    // session, and retain null for any tail which still has not terminated.
    await context?.close().catch(error => result.errors.push(safeErrorMessage(error)));
    if (trace) {
      await new Promise(resolve => setTimeout(resolve, 300));
      try {
        const events = await trace.stop();
        result.trace = await writeTraceArtifact(dir, events);
        const parsed = parseTrace({ traceEvents: events });
        result.primary = evaluateSequence(parsed, NATIVE_SCROLL_SEQUENCE);
        result.warnings = parsed.warnings;
      } catch (error) { result.errors.push(safeErrorMessage(error)); }
    }
    await traceCDP?.detach().catch(() => {});
    const quality = result.highSurfaces?.before.pass && result.highSurfaces?.after.pass;
    const content = result.jsraf?.content;
    result.status = result.errors.length ? 'error' : !quality ? 'invalid'
      : result.primary?.thresholds.pass && content?.frames > 0 && content.incompleteTextFrames === 0 ? 'pass' : 'fail';
    await writeJson(resolve(dir, 'result.json'), result);
  }
  return result;
}

async function main() {
  const variants = PAIR_URL ? [{ id: 'A', url: PAIR_URL }, { id: 'B', url: BASE_URL }] : [{ id: 'current', url: BASE_URL }];
  const builds = await Promise.all(variants.map(async variant => ({ ...variant, build: await fetchBuildMetadata(variant.url) })));
  await writeJson(resolve(OUT_ROOT, 'builds.json'), builds);
  const launchArgs = ['--enable-gpu', '--start-maximized', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];
  const browser = await chromium.launch({ headless: HEADLESS, executablePath: BROWSER_PATH, args: launchArgs });
  const samples = [];
  try {
    const cdp = await browser.newBrowserCDPSession();
    const systemInfo = await cdp.send('SystemInfo.getInfo');
    await writeJson(resolve(OUT_ROOT, 'environment.json'), {
      collectedAt: new Date().toISOString(), requestedWindow: REQUESTED_WINDOW, headless: HEADLESS,
      platform: platform(), arch: arch(), osRelease: release(), cpu: cpus()[0]?.model,
      memoryGiB: totalmem() / 1073741824, browser: await cdp.send('Browser.getVersion'),
      gpu: publicGpu(systemInfo), launchArgs, source: readSourceMetadata(),
      config: { rounds: ROUNDS, durationMs: DURATION_MS, background: BACKGROUND, diagnostic, recordVideo: truthy(env.BENCH_RECORD_VIDEO) },
    });
    for (let round = 0; round < ROUNDS; round++) {
      const order = round % 2 ? [...variants].reverse() : variants;
      for (const variant of order) {
        console.log(`[${round + 1}/${ROUNDS}] native-scroll ${variant.id}`);
        const result = await sample(browser, variant, round, order.map(item => item.id));
        samples.push(result);
        console.log(`  ${result.status}: ${result.primary?.metrics?.validFps ?? 'null'} fps; ${result.errors.join('; ')}`);
      }
    }
    const summary = { diagnostic, pass: !diagnostic && samples.every(item => item.status === 'pass'),
      note: 'Throughput may include incomplete content. Missing counters fail; rAF does not substitute for presentation.',
      variants: Object.fromEntries(variants.map(variant => {
        const rows = samples.filter(item => item.variant.id === variant.id);
        return [variant.id, { statuses: rows.map(item => item.status),
          presentationFpsMedian: median(rows.map(item => item.primary?.metrics?.validFps)),
          rafFpsMedian: median(rows.map(item => item.jsraf?.fps)) }];
      })), samples };
    await writeJson(resolve(OUT_ROOT, 'summary.json'), summary);
    console.log(`Results: ${OUT_ROOT}`);
    if (samples.some(item => ['error', 'invalid'].includes(item.status)) || (!diagnostic && !summary.pass)) process.exitCode = 1;
  } finally { await browser.close(); }
}

await main();
