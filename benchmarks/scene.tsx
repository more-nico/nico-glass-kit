import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { GlassProvider, GlassSurface, GlassText, GlassElasticityGroup } from '../src/index';
import { clearLensMapCache, lensMapCacheStats, computeLensPixels } from '../src/core/displacementMap';
import './style.css';
import '../src/tokens.css';
import '../src/core/glass.css';

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? 25);
const quality = params.get('quality') === 'medium' ? 'medium' : 'high';
const group = params.get('mode') === 'group';
const root = createRoot(document.getElementById('root')!);
function Scene({ visible = true }: { visible?: boolean }) {
  const surfaces = <main id="grid">{visible && Array.from({ length: count }, (_, i) =>
    <GlassSurface key={i} quality={quality} cornerRadius={20 + i % 5 * 3}
      hoverBrightnessBoost={i % 7 === 0 ? 0.5 : 0} style={{ height: 90 + i % 4 * 8 }}>
      <strong>Glass {String(i + 1).padStart(3, '0')}</strong><span>Refraction · dispersion · clear bevel</span>
      {i % 9 === 0 && <GlassSurface quality={quality} style={{ padding: '3px 12px' }}>Nested</GlassSurface>}
    </GlassSurface>)}</main>;
  return <GlassProvider quality={quality} lensMapRasterScale={Number(params.get('scale') ?? 0.2)}>
    <div id="backdrop"><div className="lines"/><div className="orb a"/><div className="orb b"/><div className="orb c"/></div>
    <header>OPTICAL GLASS <small>Deterministic rendering benchmark</small></header>
    {group ? <GlassElasticityGroup>{surfaces}</GlassElasticityGroup> : surfaces}
    {visible && <GlassText text="GLASS 2026" fontSize={68} fontFamily="Arial" quality={quality}/>}
  </GlassProvider>;
}
const mount = (visible = true) => flushSync(() => root.render(<Scene visible={visible}/>));
mount();
await document.fonts.ready;

type Result = { elapsedMs: number; intervals: number[]; longTasks: number[]; cache: ReturnType<typeof lensMapCacheStats> };
let running = false;
const pose = (phase: number) => {
  document.getElementById('backdrop')!.style.transform = `translate(${Math.sin(phase) * 45}px,${Math.cos(phase * 0.7) * 25}px)`;
};
const api = {
  ready: true,
  pose() { pose(0); document.getElementById('grid')!.style.removeProperty('width'); },
  stats() { return { cache: lensMapCacheStats(), filters: document.querySelectorAll('filter').length, surfaces: document.querySelectorAll('.ngs-surface').length }; },
  async measure(durationMs: number, mode: string): Promise<Result> {
    const intervals: number[] = [], longTasks: number[] = [];
    const observer = new PerformanceObserver(list => { for (const e of list.getEntries()) longTasks.push(e.duration); });
    observer.observe({ type: 'longtask', buffered: false });
    const start = performance.now();
    let previous = start;
    running = true;
    await new Promise<void>(resolve => {
      const tick = (now: number) => {
        intervals.push(now - previous); previous = now;
        const elapsed = now - start;
        if (mode !== 'idle') pose(elapsed / 900);
        if (mode === 'resize') document.getElementById('grid')!.style.width = `${90 + Math.round(Math.sin(elapsed / 650) * 5)}%`;
        if (mode === 'pointer' || mode === 'group') {
          const grid = document.getElementById('grid')!.getBoundingClientRect();
          const x = grid.left + grid.width * (0.5 + Math.sin(elapsed / 500) * 0.35);
          const y = grid.top + Math.min(grid.height, innerHeight - grid.top) * (0.5 + Math.cos(elapsed / 650) * 0.35);
          const target = document.elementFromPoint(x, y) ?? document.body;
          // Burst models high-polling mice; every sample has the same cost on both revisions.
          for (let j = 0; j < 8; j++) target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x + j * 0.05, clientY: y }));
        }
        if (mode === 'scroll') scrollTo(0, (1 + Math.sin(elapsed / 650)) * 550);
        if (elapsed >= durationMs) { running = false; resolve(); } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer.disconnect();
    return { elapsedMs: performance.now() - start, intervals, longTasks, cache: lensMapCacheStats() };
  },
  async churn(cycles = 8) {
    for (let i = 0; i < cycles; i++) { mount(false); await new Promise(r => setTimeout(r, 150)); mount(); await new Promise(r => setTimeout(r, 350)); }
    mount(false); await new Promise(r => setTimeout(r, 350)); return api.stats();
  },
  pixels() {
    clearLensMapCache();
    const times: number[] = []; let hash = 2166136261;
    for (let i = 0; i < 8; i++) {
      const start = performance.now();
      const pixels = computeLensPixels({ width: 1920 + i, height: 1080, radius: 48, edge: 8, curvature: 0.2, strength: 1, dpr: 2 });
      times.push(performance.now() - start);
      for (let k = 0; k < pixels.length; k++) hash = Math.imul(hash ^ pixels[k], 16777619);
    }
    return { times, hash: hash >>> 0 };
  },
  get running() { return running; },
};
(window as unknown as { glassBenchmark: typeof api }).glassBenchmark = api;
