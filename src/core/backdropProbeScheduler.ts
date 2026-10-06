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

import { consumeBackdropPaintChange, invalidateBackdropPaintInfo, onImagesSettled, withBackdropProbeBatch } from './backdropProbe';

const PROBE_THROTTLE_MS = 120;
const PROBE_BUDGET_MS = 6;
// Resuming every point in a fresh frame repeats the costly first hit-test and
// style flush. Give an unfinished grid a slightly larger catch-up slice, then
// measure its cheaper continuation points. Keep the complete nine-point result
// responsive instead of trading multi-second tint lag for smoother rAF numbers.
const PROBE_CATCHUP_BUDGET_MS = 16;
// Actual paint changes get a larger slice so new colours/images are not held
// behind a slowly sampled motion queue. Native calls remain indivisible.
const PROBE_PAINT_BUDGET_MS = 32;
const INTERNAL_ATTR = 'data-ngs-internal';
/**
 * A `data-ngs-light` flip animates the tint over `--ngs-transition` (240 ms).
 * Probing before it settles would read the mid-transition colour and can lock
 * an overlapping element into the wrong mode (see CHANGELOG / AGENTS.md), so
 * mutation-triggered probes are deferred past this window. Scroll/resize
 * triggers are unaffected.
 */
const LIGHT_SETTLE_MS = 260;

export interface ProbeTarget {
  /** Element to probe; read at decision/run time so element swaps survive. */
  readonly el: HTMLElement | null;
  /**
   * Optional group region used for scroll decisions instead of `el`'s rect.
   * A group spans several elements, so the union rect decides whether a
   * scroll could have changed any of their backdrops.
   */
  readonly region?: () => ScrollRect | null;
  /** Probe + Light/Dark decision; keeps its own hidden/offscreen guards. */
  run(): void;
  /** Optional resumable probe; one next() performs at most one native hit-test. */
  createTask?(): Iterator<void, void>;
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

/**
 * True for the `data-ngs-light` attribute flips the library writes when a
 * surface changes mode. These pass the internal filter (a stacked element
 * really may need to re-read them) but their probe is deferred until the
 * tint transition settles, so the probe never samples the intermediate
 * colour.
 */
export function isLightFlipMutation(record: MutationRecord): boolean {
  return record.type === 'attributes' && record.attributeName === 'data-ngs-light';
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
  lastProbeCostMs: number;
  task: Iterator<void, void> | null;
  taskCostMs: number;
  lastRunCostMs: number;
  taskSteps: number;
  lastStepCount: number;
  continuationCostMs: number;
  urgent: boolean;
}

const entries = new Map<ProbeTarget, TargetEntry>();
const activeScrollers = new Set<unknown>();
let listening = false;
let rafId = 0;
let lightSettleTimer = 0;
let mutationObserver: MutationObserver | null = null;
let unsubscribeImages: (() => void) | null = null;
let batchOffsets: Map<unknown, ScrollOffset> | null = null;
let scrollBatchActive = false;
let batchCursor = 0;

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
  if (lightSettleTimer) {
    window.clearTimeout(lightSettleTimer);
    lightSettleTimer = 0;
  }
  activeScrollers.clear();
  batchCursor = 0;
}

function onScroll(event: Event): void {
  activeScrollers.add(event.target);
  for (const entry of entries.values()) entry.scrollPending = true;
  scheduleBatch();
}

function onGenericTrigger(event?: Event, urgent = true): void {
  // Mutations/resizes may have changed what elements paint; the probe's
  // per-node background analysis cache must not outlive that.
  invalidateBackdropPaintInfo();
  for (const entry of entries.values()) {
    if (event?.type === 'visibilitychange') { entry.task?.return?.(); entry.task = null; }
    if (urgent) { entry.task?.return?.(); entry.task = null; entry.urgent = true; }
    entry.needsRun = true;
  }
  scheduleBatch();
}

function onMutations(records: MutationRecord[]): void {
  if (records.every(isInternalMutation)) return;
  // Light/Dark flips animate the tint: wait for the transition to settle so
  // probes read the final colour instead of the intermediate one.
  if (records.some(isLightFlipMutation)) {
    scheduleSettledTrigger();
    return;
  }
  // Class/tree changes can replace paint directly. Inline style mutations are
  // often just transforms; compare the paint during the next actual sample.
  onGenericTrigger(undefined, records.some(record => !isInternalMutation(record) &&
    (record.type !== 'attributes' || record.attributeName !== 'style')));
}

function scheduleSettledTrigger(): void {
  if (typeof window === 'undefined') return;
  if (lightSettleTimer) window.clearTimeout(lightSettleTimer);
  lightSettleTimer = window.setTimeout(() => {
    lightSettleTimer = 0;
    onGenericTrigger(undefined, false);
  }, LIGHT_SETTLE_MS);
}

function scheduleBatch(): void {
  if (rafId || typeof requestAnimationFrame === 'undefined' || document.hidden) return;
  rafId = requestAnimationFrame(runBatch);
}

function hasRunnableWork(): boolean {
  for (const entry of entries.values()) {
    if (entry.task) return true;
    if (entry.scrollPending) return true;
    if (entry.needsRun && entry.trailing === undefined) return true;
  }
  return false;
}

function runBatch(): void {
  rafId = 0;
  if (document.hidden) return;
  if (consumeBackdropPaintChange()) promotePaintChange();
  const start = now();
  // Reading scrollY can flush layout. A wholly throttled batch must do no DOM
  // reads; take the shared snapshot lazily on its first real probe/scroll check.
  scrollBatchActive = true;
  try {
    withBackdropProbeBatch(() => {
      const work = [...entries.values()];
      const first = batchCursor % Math.max(1, work.length);
      let ranProbe = false;
      for (let checked = 0; checked < work.length; checked++) {
        const index = (first + checked) % work.length;
        const entry = work[index];
        if (!entry.needsRun && !entry.scrollPending && !entry.task) continue;
        batchCursor = index;
        if (now() - start > PROBE_BUDGET_MS) break;
        if (entry.scrollPending) decideScroll(entry);
        if (entry.task || (entry.needsRun && entry.trailing === undefined)) {
          // A slow native hit-test is indivisible. Learn its cost and avoid
          // starting a second expensive probe that would overrun this frame.
          // Resume from that entry next frame so late subscribers cannot starve.
          const predicted = !entry.task && entry.lastRunCostMs > 0 && entry.lastRunCostMs <= PROBE_BUDGET_MS
            ? entry.lastRunCostMs : entry.lastProbeCostMs;
          if (ranProbe && now() - start + predicted > PROBE_BUDGET_MS) break;
          ranProbe = tryRun(entry, start + PROBE_BUDGET_MS) || ranProbe;
          if (entry.task) break; // Resume this finite grid before rotating on.
        }
        batchCursor = (index + 1) % work.length;
      }
    });
  } finally { batchOffsets = null; scrollBatchActive = false; }
  if (hasRunnableWork()) scheduleBatch();
}

function tryRun(entry: TargetEntry, deadline: number): boolean {
  const batchStart = deadline - PROBE_BUDGET_MS;
  const resuming = entry.task !== null;
  if (entry.urgent) deadline = batchStart + PROBE_PAINT_BUDGET_MS;
  else if (resuming) deadline = batchStart + PROBE_CATCHUP_BUDGET_MS;
  const fastCandidate = !entry.task && entry.lastRunCostMs > 0 && entry.lastRunCostMs <= PROBE_BUDGET_MS;
  if (!entry.task) {
    const elapsed = now() - entry.lastRunAt;
    if (elapsed < PROBE_THROTTLE_MS) {
      if (entry.trailing === undefined) {
        entry.trailing = window.setTimeout(() => {
          entry.trailing = undefined;
          scheduleBatch();
        }, PROBE_THROTTLE_MS - elapsed);
      }
      return false;
    }
    entry.lastRunAt = now();
    entry.needsRun = false;
    if (entry.target.createTask) {
      entry.task = entry.target.createTask();
      entry.taskCostMs = 0;
      entry.taskSteps = 0;
      entry.continuationCostMs = 0;
    }
  }
  if (entry.task) {
    let ran = false;
    while (entry.task) {
      // The first point after a frame boundary includes a layout/style flush;
      // its cost overestimates subsequent points sharing this batch's DOM reads.
      // Explore one continuation in the catch-up slice, then use measured cost.
      const predicted = resuming
        ? entry.continuationCostMs || Math.min(entry.lastProbeCostMs, 2)
        : entry.lastProbeCostMs;
      if (now() >= deadline || (ran && now() + predicted > deadline)) break;
      const start = now();
      const step = entry.task.next();
      const cost = now() - start;
      if (ran) entry.continuationCostMs = cost;
      entry.taskCostMs += cost;
      if (consumeBackdropPaintChange()) {
        // A fresh first sample already reads the new paint. A partly sampled
        // old grid must restart so a black-to-white switch cannot average stale
        // black samples into the new result. next() has returned, so cancellation
        // cannot re-enter a running generator.
        const keep = !step.done && entry.taskSteps === 0;
        promotePaintChange(keep ? entry : undefined);
        deadline = batchStart + PROBE_PAINT_BUDGET_MS;
        if (!keep) { ran = true; break; }
      }
      if (step.done) {
        completeTask(entry);
      } else {
        entry.taskSteps++;
        entry.lastProbeCostMs = cost;
        // Check this run's first point before taking the fast path. A device
        // or DOM that suddenly slows down must not run a formerly cheap grid
        // as one long task. Cheap known grids avoid clocks at every point.
        const remaining = Math.max(entry.lastRunCostMs - cost, cost * (entry.lastStepCount - 1));
        if (fastCandidate && entry.taskSteps === 1 &&
          cost <= PROBE_BUDGET_MS / Math.max(1, entry.lastStepCount) && now() + remaining <= deadline) {
          const drainStart = now();
          let next = entry.task.next();
          while (!next.done) { entry.taskSteps++; next = entry.task.next(); }
          entry.taskCostMs += now() - drainStart;
          completeTask(entry);
        }
      }
      ran = true;
    }
    return ran;
  } else {
    const probeStart = now();
    entry.target.run();
    refreshCheck(entry);
    entry.lastProbeCostMs = now() - probeStart;
    entry.lastRunCostMs = Math.max(0.001, entry.lastProbeCostMs);
    entry.urgent = false;
    return true;
  }
}

function completeTask(entry: TargetEntry): void {
  entry.task = null;
  entry.urgent = false;
  entry.lastRunCostMs = Math.max(0.001, entry.taskCostMs);
  entry.lastStepCount = entry.taskSteps;
  refreshCheck(entry);
}

function promotePaintChange(keep?: TargetEntry): void {
  for (const entry of entries.values()) {
    entry.urgent = true;
    if (entry !== keep) {
      entry.task?.return?.(); entry.task = null;
      entry.needsRun = true;
    }
  }
}

function scrollerOffsets(): Map<unknown, ScrollOffset> {
  if (batchOffsets) return batchOffsets;
  const offsets = new Map<unknown, ScrollOffset>();
  offsets.set(document, { top: window.scrollY, left: window.scrollX });
  for (const scroller of activeScrollers) {
    if (scroller === document || !(scroller instanceof Element)) continue;
    if (!scroller.isConnected) { activeScrollers.delete(scroller); continue; }
    offsets.set(scroller, { top: scroller.scrollTop, left: scroller.scrollLeft });
  }
  if (scrollBatchActive) batchOffsets = offsets;
  return offsets;
}

function mergeOffsets(
  last: CheckSnapshot | null,
  fresh: Map<unknown, ScrollOffset>,
): Map<unknown, ScrollOffset> {
  const merged = new Map<unknown, ScrollOffset>();
  for (const [scroller, offset] of last?.offsets ?? []) {
    if (!(scroller instanceof Element) || scroller.isConnected) merged.set(scroller, offset);
  }
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

/** Probe rect: the group's region when provided, else the element's box. */
function targetRect(entry: TargetEntry): ScrollRect | null {
  if (entry.target.region) return entry.target.region();
  const el = entry.target.el;
  if (!el || !el.isConnected) return null;
  return rectOf(el);
}

function decideScroll(entry: TargetEntry): void {
  entry.scrollPending = false;
  const rect = targetRect(entry);
  if (!rect) return;
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
  const rect = targetRect(entry);
  if (!rect) {
    entry.lastCheck = null;
    return;
  }
  entry.lastCheck = { rect, offsets: mergeOffsets(entry.lastCheck, scrollerOffsets()) };
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
    lastProbeCostMs: 0,
    task: null,
    taskCostMs: 0,
    lastRunCostMs: 0,
    taskSteps: 0,
    lastStepCount: 0,
    continuationCostMs: 0,
    urgent: false,
  };
  entries.set(target, entry);
  startListening();
  refreshCheck(entry);
  scheduleBatch();
  return () => {
    const existing = entries.get(target);
    if (!existing) return;
    if (existing.trailing !== undefined) window.clearTimeout(existing.trailing);
    existing.task?.return?.();
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
