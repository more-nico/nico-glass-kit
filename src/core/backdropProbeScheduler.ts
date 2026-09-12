/**
 * Shared scheduling for `overLight: 'auto'` backdrop probes.
 *
 * Every auto-mode glass element must re-probe when the paint beneath it may
 * have changed: scrolls, resizes, DOM mutations, background-image decodes.
 * Per-element listeners multiply the global observers and — worse — let the
 * library's own high-frequency DOM writes (pointer-tracked rim-light CSS
 * vars, the elasticity spring's per-frame transform, registry filter
 * attribute mutations) re-trigger probes for *every* element.
 *
 * This module installs ONE set of listeners for all subscribers and:
 *  - batches pending probes into a single rAF pass with a per-frame time
 *    budget, so style/layout flushes amortise and React updates coalesce;
 *  - ignores mutations the library itself causes (see the `data-ngs-internal`
 *    zones) while still forwarding everything a real backdrop change needs
 *    (class swaps, `data-ngs-light`, childList);
 *  - skips probes for scrolls that cannot have changed an element's
 *    backdrop: elements that moved along with the scrolled content (their
 *    document-relative backdrop is unchanged) and scrollers that do not
 *    overlap the element.
 *
 * The scroll decision and the mutation filter are pure and exported for
 * node tests; only the bottom section touches the DOM.
 */

import { invalidateBackdropPaintInfo, onImagesSettled } from './backdropProbe';

const PROBE_THROTTLE_MS = 120;
const PROBE_BUDGET_MS = 6;
const INTERNAL_ATTR = 'data-ngs-internal';

export interface ProbeTarget {
  /** Element to probe; read at decision/run time so element swaps survive. */
  readonly el: HTMLElement | null;
  /** Probe + Light/Dark decision; keeps its own hidden/offscreen guards. */
  run(): void;
}

/* ------------------------------------------------------------------ */
/* Mutation filter (pure)                                              */
/* ------------------------------------------------------------------ */

/**
 * True for mutations the library itself causes. Layer zones
 * (`data-ngs-internal="style"` on .ngs-motion/.ngs-effect/.ngs-highlight/
 * .ngs-content) only mute their own `style` attribute writes; the filter
 * registry zone (`data-ngs-internal="all"` on the hidden SVG) mutes
 * everything inside it. Class swaps, `data-ngs-light` flips and childList
 * changes always pass through — they can be real backdrop changes (e.g. an
 * active tab pill that glass elements are stacked on top of).
 */
export function isInternalMutation(record: MutationRecord): boolean {
  const target = record.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  const zone = target.closest(`[${INTERNAL_ATTR}]`);
  if (!zone || typeof zone.getAttribute !== 'function') return false;
  if (zone.getAttribute(INTERNAL_ATTR) === 'all') return true;
  return record.type === 'attributes' && record.attributeName === 'style';
}

/* ------------------------------------------------------------------ */
/* Scroll decision (pure)                                              */
/* ------------------------------------------------------------------ */

export interface ScrollRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface ScrollOffset {
  top: number;
  left: number;
}

export interface ScrollProbeInput {
  /** Element viewport rect at decision time. */
  rect: ScrollRect;
  /** Element rect + scroller offsets at the previous decision/run. */
  last: { rect: ScrollRect; offsets: ReadonlyMap<unknown, ScrollOffset> } | null;
  /** Scroller offsets at decision time (viewport scroller included). */
  offsets: ReadonlyMap<unknown, ScrollOffset>;
  /** Whether a scroller's visible area overlaps the element rect. */
  intersects: (scroller: unknown) => boolean;
}

const MOVE_EPSILON = 1;

/**
 * Whether any scroller moved in a way that could have changed the paint
 * beneath the element:
 *  - moved along with the content (rect delta == scroller delta) → no;
 *  - anchored (rect unchanged) while a non-overlapping scroller scrolled → no;
 *  - anchored over an overlapping scroller, or moved abnormally (layout
 *    shift, sticky) → yes, conservatively.
 * Scrollers without a baseline only probe when they overlap the element
 * (rules out far-away inner scrollers on first sight).
 */
export function decideScrollProbe(input: ScrollProbeInput): boolean {
  const { rect, last, offsets, intersects } = input;
  let probe = false;
  for (const [scroller, offset] of offsets) {
    const baseline = last?.offsets.get(scroller);
    if (!baseline) {
      if (intersects(scroller)) probe = true;
      continue;
    }
    const dTop = offset.top - baseline.top;
    const dLeft = offset.left - baseline.left;
    if (Math.abs(dTop) < 0.5 && Math.abs(dLeft) < 0.5) continue;
    const baseRect = last?.rect;
    if (!baseRect) continue;
    const sameSize =
      Math.abs(rect.width - baseRect.width) < MOVE_EPSILON &&
      Math.abs(rect.height - baseRect.height) < MOVE_EPSILON;
    const movedWithContent =
      sameSize &&
      Math.abs(rect.top - baseRect.top - dTop) < MOVE_EPSILON &&
      Math.abs(rect.left - baseRect.left - dLeft) < MOVE_EPSILON;
    if (movedWithContent) continue;
    const anchored =
      sameSize &&
      Math.abs(rect.top - baseRect.top) < MOVE_EPSILON &&
      Math.abs(rect.left - baseRect.left) < MOVE_EPSILON;
    if (anchored && !intersects(scroller)) continue;
    probe = true;
  }
  return probe;
}

/* ------------------------------------------------------------------ */
/* DOM glue                                                            */
/* ------------------------------------------------------------------ */

interface CheckSnapshot {
  rect: ScrollRect;
  offsets: Map<unknown, ScrollOffset>;
}

interface TargetEntry {
  target: ProbeTarget;
  needsRun: boolean;
  scrollPending: boolean;
  lastRunAt: number;
  trailing: number | undefined;
  lastCheck: CheckSnapshot | null;
}

const entries = new Map<ProbeTarget, TargetEntry>();
const activeScrollers = new Set<unknown>();
let listening = false;
let rafId = 0;
let mutationObserver: MutationObserver | null = null;
let unsubscribeImages: (() => void) | null = null;

const now = (): number => performance.now();

function startListening(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('resize', onGenericTrigger);
  document.addEventListener('visibilitychange', onGenericTrigger);
  mutationObserver = new MutationObserver(onMutations);
  mutationObserver.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  unsubscribeImages = onImagesSettled(onGenericTrigger);
}

function stopListening(): void {
  if (!listening) return;
  listening = false;
  window.removeEventListener('scroll', onScroll, { capture: true });
  window.removeEventListener('resize', onGenericTrigger);
  document.removeEventListener('visibilitychange', onGenericTrigger);
  mutationObserver?.disconnect();
  mutationObserver = null;
  unsubscribeImages?.();
  unsubscribeImages = null;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  activeScrollers.clear();
}

function onScroll(event: Event): void {
  activeScrollers.add(event.target);
  for (const entry of entries.values()) entry.scrollPending = true;
  scheduleBatch();
}

function onGenericTrigger(): void {
  // Mutations/resizes may have changed what elements paint; the probe's
  // per-node background analysis cache must not outlive that.
  invalidateBackdropPaintInfo();
  for (const entry of entries.values()) entry.needsRun = true;
  scheduleBatch();
}

function onMutations(records: MutationRecord[]): void {
  if (records.every(isInternalMutation)) return;
  onGenericTrigger();
}

function scheduleBatch(): void {
  if (rafId || typeof requestAnimationFrame === 'undefined') return;
  rafId = requestAnimationFrame(runBatch);
}

function hasRunnableWork(): boolean {
  for (const entry of entries.values()) {
    if (entry.scrollPending) return true;
    if (entry.needsRun && entry.trailing === undefined) return true;
  }
  return false;
}

function runBatch(): void {
  rafId = 0;
  const start = now();
  for (const entry of [...entries.values()]) {
    if (!entry.needsRun && !entry.scrollPending) continue;
    if (now() - start > PROBE_BUDGET_MS) break;
    if (entry.scrollPending) decideScroll(entry);
    if (entry.needsRun) tryRun(entry);
  }
  if (hasRunnableWork()) scheduleBatch();
}

function tryRun(entry: TargetEntry): void {
  const elapsed = now() - entry.lastRunAt;
  if (elapsed >= PROBE_THROTTLE_MS) {
    entry.lastRunAt = now();
    entry.needsRun = false;
    entry.target.run();
    refreshCheck(entry);
    return;
  }
  if (entry.trailing === undefined) {
    entry.trailing = window.setTimeout(() => {
      entry.trailing = undefined;
      scheduleBatch();
    }, PROBE_THROTTLE_MS - elapsed);
  }
}

function scrollerOffsets(): Map<unknown, ScrollOffset> {
  const offsets = new Map<unknown, ScrollOffset>();
  offsets.set(document, { top: window.scrollY, left: window.scrollX });
  for (const scroller of activeScrollers) {
    if (scroller === document || !(scroller instanceof Element)) continue;
    offsets.set(scroller, { top: scroller.scrollTop, left: scroller.scrollLeft });
  }
  return offsets;
}

function mergeOffsets(
  last: CheckSnapshot | null,
  fresh: Map<unknown, ScrollOffset>,
): Map<unknown, ScrollOffset> {
  const merged = new Map(last?.offsets ?? []);
  for (const [scroller, offset] of fresh) merged.set(scroller, offset);
  return merged;
}

function scrollerIntersects(scroller: unknown, rect: ScrollRect): boolean {
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;
  if (scroller === document) {
    return (
      bottom > 0 &&
      rect.top < window.innerHeight &&
      right > 0 &&
      rect.left < window.innerWidth
    );
  }
  if (!(scroller instanceof Element)) return false;
  const box = scroller.getBoundingClientRect();
  return bottom > box.top && rect.top < box.bottom && right > box.left && rect.left < box.right;
}

function rectOf(el: HTMLElement): ScrollRect {
  const box = el.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function decideScroll(entry: TargetEntry): void {
  entry.scrollPending = false;
  const el = entry.target.el;
  if (!el || !el.isConnected) return;
  const rect = rectOf(el);
  const offsets = mergeOffsets(entry.lastCheck, scrollerOffsets());
  const last = entry.lastCheck;
  entry.lastCheck = { rect, offsets };
  if (entry.needsRun) return;
  if (
    decideScrollProbe({
      rect,
      last,
      offsets,
      intersects: (scroller) => scrollerIntersects(scroller, rect),
    })
  ) {
    entry.needsRun = true;
  }
}

function refreshCheck(entry: TargetEntry): void {
  const el = entry.target.el;
  if (!el || !el.isConnected) {
    entry.lastCheck = null;
    return;
  }
  entry.lastCheck = { rect: rectOf(el), offsets: mergeOffsets(entry.lastCheck, scrollerOffsets()) };
}

/** Subscribes a probe target; schedules its first probe immediately. */
export function subscribeProbe(target: ProbeTarget): () => void {
  const entry: TargetEntry = {
    target,
    needsRun: true,
    scrollPending: false,
    lastRunAt: 0,
    trailing: undefined,
    lastCheck: null,
  };
  entries.set(target, entry);
  startListening();
  refreshCheck(entry);
  scheduleBatch();
  return () => {
    const existing = entries.get(target);
    if (!existing) return;
    if (existing.trailing !== undefined) window.clearTimeout(existing.trailing);
    entries.delete(target);
    if (entries.size === 0) stopListening();
  };
}

/** External per-element trigger (e.g. the element's own ResizeObserver). */
export function invalidateProbe(target: ProbeTarget): void {
  const entry = entries.get(target);
  if (!entry) return;
  entry.needsRun = true;
  scheduleBatch();
}
