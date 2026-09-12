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

      if (fpsRef.current) fpsRef.current.textContent = String(fps);
      if (msRef.current) msRef.current.textContent = `p95 ${p95.toFixed(1)}ms`;
      const root = rootRef.current;
      if (root) root.dataset.level = levelFor(p95);
      drawGraph();
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <GlassCard className="pg-fps" padding="8px 12px" cornerRadius={999} {...glassProps(params)}>
      <div className="pg-fps-row" ref={rootRef} data-level="good" aria-hidden="true">
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
