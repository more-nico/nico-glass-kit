/** One native rAF for all active springs, glints and pointer reads. */
let callbacks = new Map<number, FrameRequestCallback>();
let running: Map<number, FrameRequestCallback> | null = null;
let nativeFrame = 0;
let nextId = 0;

function flush(time: number): void {
  nativeFrame = 0;
  const work = callbacks;
  callbacks = new Map();
  running = work;
  // Requests made during a callback belong to the next frame, just as with
  // native rAF. Deleting before invocation also makes in-frame cancellation safe.
  for (const [id, callback] of work) {
    work.delete(id);
    try { callback(time); } catch (error) {
      // A failing animation must not stop all other surfaces in this batch.
      queueMicrotask(() => { throw error; });
    }
  }
  running = null;
}

export function requestGlassFrame(callback: FrameRequestCallback): number {
  const id = ++nextId;
  callbacks.set(id, callback);
  if (!nativeFrame) nativeFrame = requestAnimationFrame(flush);
  return id;
}

export function cancelGlassFrame(id: number): void {
  callbacks.delete(id);
  running?.delete(id);
  if (!callbacks.size && nativeFrame) {
    cancelAnimationFrame(nativeFrame);
    nativeFrame = 0;
  }
}
