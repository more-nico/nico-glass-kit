import { afterEach, describe, expect, it, vi } from 'vitest';
import { subscribeSurfacePointer } from './surfacePointer';
afterEach(() => vi.unstubAllGlobals());
describe('surface pointer batching', () => {
  it('uses the latest sample and one layout read for glint and elasticity, cancels stale moves on leave', () => {
    const frames = new Map<number, FrameRequestCallback>(); let id = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id; });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
    const element = Object.assign(new EventTarget(), { isConnected: true, getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 200, height: 100 })) }) as unknown as HTMLElement;
    const a = vi.fn(), b = vi.fn(); const offA = subscribeSurfacePointer(element, a), offB = subscribeSurfacePointer(element, b);
    const move = (x: number) => element.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x, clientY: 50 }));
    for (let i = 0; i < 8; i++) move(10 + i * 10);
    expect(frames.size).toBe(1); const callbacks = [...frames.values()]; frames.clear(); callbacks[0](16);
    expect(element.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledTimes(1); expect(b).toHaveBeenCalledWith(a.mock.calls[0][0]);
    expect(a.mock.calls[0][0]).toMatchObject({ x: 40, y: 50, ny: 0 });
    expect(a.mock.calls[0][0].nx).toBeCloseTo(-0.1);
    move(150); element.dispatchEvent(new Event('pointerleave'));
    expect(frames.size).toBe(0); expect(a).toHaveBeenLastCalledWith(null);
    offA(); move(170); offB(); expect(frames.size).toBe(0);
    move(190); expect(frames.size).toBe(0);
  });
});
