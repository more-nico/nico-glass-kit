import { cancelGlassFrame, requestGlassFrame } from './animationFrame';

export interface SurfacePointer {
  x: number; y: number; nx: number; ny: number; distance: number;
}
type Handler = (pointer: SurfacePointer | null) => void;
interface Subscription { listeners: Set<Handler>; dispose(): void; }
const subscriptions = new Map<HTMLElement, Subscription>();

/**
 * Glint and elasticity share one listener pair and one rectangle read. The
 * latest event in a high-polling burst is the only position that can be painted
 * in the next frame. Leave/cancel clears pending work before resetting.
 */
export function subscribeSurfacePointer(element: HTMLElement, handler: Handler): () => void {
  let subscription = subscriptions.get(element);
  if (!subscription) {
    const listeners = new Set<Handler>();
    let raf = 0;
    let x = 0, y = 0;
    const flush = () => {
      raf = 0;
      const rect = element.getBoundingClientRect();
      if (!element.isConnected || !rect.width || !rect.height) return;
      const px = (x - rect.left) / rect.width, py = (y - rect.top) / rect.height;
      const nx = px - 0.5, ny = py - 0.5;
      const pointer = { x: px * 100, y: py * 100, nx, ny, distance: Math.min(1, Math.hypot(nx, ny) * 2) };
      for (const listener of listeners) listener(pointer);
    };
    const move = (event: PointerEvent) => {
      x = event.clientX; y = event.clientY;
      if (!raf) raf = requestGlassFrame(flush);
    };
    const leave = () => {
      if (raf) cancelGlassFrame(raf);
      raf = 0;
      for (const listener of listeners) listener(null);
    };
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('pointerleave', leave);
    element.addEventListener('pointercancel', leave);
    subscription = { listeners, dispose() {
      if (raf) cancelGlassFrame(raf);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('pointercancel', leave);
    } };
    subscriptions.set(element, subscription);
  }
  subscription.listeners.add(handler);
  return () => {
    subscription.listeners.delete(handler);
    if (!subscription.listeners.size) { subscription.dispose(); subscriptions.delete(element); }
  };
}
