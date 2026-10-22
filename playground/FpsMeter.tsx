import { useEffect, useRef } from 'react';
import { GlassCard } from 'nico-glass-kit';
import type { DemoParams } from './App';
import { glassProps } from './demos/demoProps';

/**
 * Fixed-frame FPS HUD for the playground. It rides on a GlassCard so the
 * overlay follows the active theme, which makes the HUD itself a glass surface
 * participating in per-frame backdrop rendering — it will slightly lower the
 * frame rate it reports. That is a deliberate, accepted trade-off. All
 * per-frame bookkeeping stays in refs: the text/canvas update at 4 Hz via
 * direct DOM mutation, never React re-renders.
 *
 * The HUD row is marked `data-ngs-internal="all"` because those 4 Hz text and
 * `data-level` writes are not backdrop changes. Without the marker the shared
 * probe scheduler sees childList/attribute records every 250 ms and starts an
 * urgent nine-point re-probe of every auto surface. The marker covers only
 * this HUD, so page paint changes still reach the scheduler normally.
 */

const WINDOW_FRAMES = 180; // ~3 s of frame deltas at 60 Hz
const UPDATE_MS = 250;
const GRAPH_W = 132;
const GRAPH_H = 34;

type Level = 'good' | 'ok' | 'bad';

const BAR_COLORS_DARK: Record<Level, string> = {
  good: '#4ade80',
  ok: '#facc15',
  bad: '#f87171',
};

const BAR_COLORS_LIGHT: Record<Level, string> = {
  good: '#16a34a',
  ok: '#ca8a04',
  bad: '#dc2626',
};

function levelFor(p95: number): Level {
  if (p95 <= 20) return 'good';
  if (p95 <= 34) return 'ok';
  return 'bad';
}

export function FpsMeter({ params }: { params: DemoParams }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const msRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = GRAPH_W * dpr;
    canvas.height = GRAPH_H * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const frames = new Float64Array(WINDOW_FRAMES);
    let count = 0;
    let raf = 0;
    let last = 0;
    let lastUpdate = 0;
    // The initial JSX already renders `--` / `data-level="good"`. Skip writes
    // that would not change the DOM; the observer marker handles the rest.
    let lastFps = -1;
    let lastP95 = -1;
    let lastLevel: Level = 'good';

    const drawGraph = () => {
      // The surface sets data-ngs-light; mirror its palette so bars stay
      // legible over a light backdrop too.
      const light =
        rootRef.current?.closest('.pg-fps')?.getAttribute('data-ngs-light') === 'true';
      const palette = light ? BAR_COLORS_LIGHT : BAR_COLORS_DARK;
      ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);
      const barW = GRAPH_W / WINDOW_FRAMES;
      const scale = (GRAPH_H * 0.85) / 33.4; // 33.4ms ≈ dropped-60fps budget
      for (let i = 0; i < count; i++) {
        const d = frames[i];
        const h = Math.max(1, Math.min(d * scale, GRAPH_H));
        ctx.fillStyle = palette[levelFor(d)];
        ctx.fillRect((i * GRAPH_W) / WINDOW_FRAMES, GRAPH_H - h, Math.max(1, barW - 0.5), h);
      }
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (last) {
        const delta = t - last;
        if (delta < 250) {
          // skip gaps from hidden-tab pauses
          if (count < WINDOW_FRAMES) frames[count++] = delta;
          else {
            frames.copyWithin(0, 1);
            frames[WINDOW_FRAMES - 1] = delta;
          }
        }
      }
      last = t;
      if (t - lastUpdate < UPDATE_MS) return;
      lastUpdate = t;
      if (count < 2) return;

      // fps over the most recent ~1 s of deltas
      let sum = 0;
      let used = 0;
      for (let i = count - 1; i >= 0 && sum < 1000; i--) {
        sum += frames[i];
        used++;
      }
      const fps = sum > 0 ? Math.round((used * 1000) / sum) : 0;

      const sorted = Array.from(frames.subarray(0, count)).sort((a, b) => a - b);
      const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];

      if (fps !== lastFps) {
        if (fpsRef.current) fpsRef.current.textContent = String(fps);
        lastFps = fps;
      }
      if (p95 !== lastP95) {
        if (msRef.current) msRef.current.textContent = `p95 ${p95.toFixed(1)}ms`;
        lastP95 = p95;
      }
      const level = levelFor(p95);
      const root = rootRef.current;
      if (root && level !== lastLevel) {
        root.dataset.level = level;
        lastLevel = level;
      }
      drawGraph();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <GlassCard className="pg-fps" padding="8px 12px" cornerRadius={999} {...glassProps(params)}>
      {/* Keep the 4 Hz HUD writes out of the backdrop-probe mutation stream.
          This only mutes mutations inside this row; real page changes still
          reach the scheduler outside it. */}
      <div
        className="pg-fps-row"
        ref={rootRef}
        data-level="good"
        data-ngs-internal="all"
        aria-hidden="true"
      >
        <span className="pg-fps-num" ref={fpsRef}>
          --
        </span>
        <span className="pg-fps-unit">fps</span>
        <span className="pg-fps-ms" ref={msRef}>
          --
        </span>
        <canvas className="pg-fps-graph" ref={canvasRef} />
      </div>
    </GlassCard>
  );
}
