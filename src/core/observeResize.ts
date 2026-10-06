/** One native observer for all library subscriptions, including nested groups. */
const callbacks = new Map<Element, Set<(entry: ResizeObserverEntry) => void>>();
let observer: ResizeObserver | null = null;

export function observeResize(element: Element, callback: (entry: ResizeObserverEntry) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  if (!observer) {
    observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        for (const listener of callbacks.get(entry.target) ?? []) listener(entry);
      }
    });
  }
  let listeners = callbacks.get(element);
  if (!listeners) { listeners = new Set(); callbacks.set(element, listeners); observer.observe(element); }
  listeners.add(callback);
  return () => {
    const current = callbacks.get(element);
    current?.delete(callback);
    if (current?.size === 0) { callbacks.delete(element); observer?.unobserve(element); }
    if (!callbacks.size) { observer?.disconnect(); observer = null; }
  };
}
