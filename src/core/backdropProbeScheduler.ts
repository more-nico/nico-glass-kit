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
 *  - skips probes only when a scroll cannot have changed an element's
 *    backdrop: a scroller that does not overlap an anchored element, or a
 *    caller that explicitly proved its paint moves with the content. Merely
 *    moving with the document flow is NOT proof: a fixed / attachment-fixed
 *    backdrop (the playground default) still shows new pixels underneath an
 *    in-flow element as it scrolls, so those probes stay conservative;
 *  - measures the per-frame probe budget from the animation-frame timestamp
 *    and rotates through targets, so a slow nine-point grid cannot repeatedly
 *    take the whole slice and starve every other surface.
 *
 * The scroll decision and the mutation filter are pure and exported for
 * node tests; only the bottom section touches the DOM.
 */

import { consumeBackdropPaintChange, invalidateBackdropPaintInfo, onImagesSettled, withBackdropProbeBatch } from './backdropProbe';

const PROBE_THROTTLE_MS = 120;
// A nine-point grid is the unit of correctness, but it must not consume the
// frame that renders the 60 Hz glass itself. Normal work and catch-up slices
// stay at 6 ms, leaving the large majority of a 16.7 ms frame for style,
// layout, paint and composite. Measured per-point costs stop the loop before
// appending another known-expensive point; rotation plus deferred frames
// completes the grid with bounded latency instead of one long task.
// A detected paint change gets a larger, still sub-frame 8 ms priority slice
// so a new colour/image is not queued behind motion samples. All budgets are
// soft: a single native hit-test cannot be preempted, so one point may overrun
// by its own cost. After such an overrun the loop stops instead of appending
// more work to the already-late frame.
const PROBE_BUDGET_MS = 6;
const PROBE_CATCHUP_BUDGET_MS = 6;
const PROBE_PAINT_BUDGET_MS = 8;
// A target's first native hit-test has no measured cost yet. Do not start a
// second unmeasured target unless at least this much slice remains; if the
// probes already run this frame cost more, use that larger measured floor. One
// unknown call may overrun, but piling several unknown calls into a late frame
// is avoidable. Known-expensive targets use their real first-point cost.
const PROBE_UNMEASURED_ESTIMATE_MS = 3;
const INTERNAL_ATTR = 'data-ngs-internal';
// GlassRenderGroup writes these on the group root and on the internal effect
// layer to describe render ownership/counts. They never affect what is painted
// underneath a glass surface. Filter the exact names anywhere: the group root
// is not inside a data-ngs-internal zone, and a broad prefix would risk hiding
// a future attribute that does affect paint. `style` inside an internal zone
// keeps the original filter rule below.
const RENDER_BOOKKEEPING_ATTRS = new Set([
  'data-ngs-render-batched',
  'data-ngs-individual-filter',
  'data-ngs-render-batches',
  'data-ngs-render-members',
]);
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
 * .ngs-content) only mute their own `style` attribute writes; a zone marked
 * `data-ngs-internal="all"` (the filter registry, or a diagnostic HUD whose
 * 4 Hz text/level writes are not backdrop changes) mutes everything inside
 * it. Render ownership/count attributes written by GlassRenderGroup are muted
 * by their exact names wherever they appear; they do not change backdrop
 * colour. Class swaps, `data-ngs-light` flips and childList changes in the
 * page always pass through — they can be real backdrop changes (e.g. an
 * active tab pill that glass elements are stacked on top of).
 */
export function isInternalMutation(record: MutationRecord): boolean {
  if (
    record.type === 'attributes' &&
    record.attributeName !== null &&
    record.attributeName !== undefined &&
    RENDER_BOOKKEEPING_ATTRS.has(record.attributeName)
  ) {
    return true;
  }
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

export interface MutationBatchAnalysis {
  /** At least one mutation outside a library-internal zone. */
  real: boolean;
  /** At least one real mutation is the library's own tint flip. */
  lightFlip: boolean;
  /**
   * At least one real mutation can replace paint immediately (class swap,
   * childList, non-style attribute). Inline style writes are excluded because
   * pointer-tracked transforms are the common case; the probe still compares
   * the paint it reads during the next sample.
   */
  urgent: boolean;
}

/**
 * Classifies a MutationObserver batch once. Checking `some(isLightFlip)` before
 * looking for real paint changes is a correctness trap: a batch that contains
 * both a tint flip and a class/tree mutation would otherwise be deferred to
 * the 260 ms settle timer and its real backdrop change would be missed until
 * then. Internal records are discarded first, so they cannot hide a page
 * mutation either.
 */
export function classifyMutations(records: readonly MutationRecord[]): MutationBatchAnalysis {
  let real = false;
  let lightFlip = false;
  let urgent = false;
  for (const record of records) {
    if (isInternalMutation(record)) continue;
    real = true;
    if (isLightFlipMutation(record)) {
      lightFlip = true;
      continue;
    }
    if (record.type !== 'attributes' || record.attributeName !== 'style') urgent = true;
  }
  return { real, lightFlip, urgent };
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
  /**
   * Optional proof that the paint beneath the element translates 1:1 with
   * this scroller's content. The scheduler cannot infer that from geometry:
   * fixed / attachment-fixed backgrounds, parallax layers, or a sticky
   * sibling painted below the glass all show different pixels even when the
   * element moves exactly with the scrolled content. Return true only after
   * verifying every layer that can show through the element; otherwise the
   * conservative path re-samples.
   */
  paintMovesWithContent?: (scroller: unknown) => boolean;
}

const MOVE_EPSILON = 1;

/**
 * Whether any scroller moved in a way that could have changed the paint
 * beneath the element.
 *
 * An element that moved with the scrolled content is NOT automatically safe
 * to skip. Its viewport rect moving by `-scrollDelta` only proves that the
 * element and the scroll box agree; it says nothing about what is painted
 * behind it. A fixed wallpaper, `background-attachment: fixed`, a parallax
 * layer, or a sticky sibling underneath still paints new pixels as the
 * element travels, so the default is a conservative probe. A caller that has
 * independently proven the paint co-moves may opt into the skip through
 * {@link ScrollProbeInput.paintMovesWithContent}.
 *
 * The remaining safe skips are:
 *  - no scroller moved;
 *  - an anchored element and a scroller whose visible box does not overlap it;
 *  - a proven co-moving paint layer (exact opposite rect delta).
 * Scrollers without a baseline only probe when they overlap the element
 * (rules out far-away inner scrollers on first sight).
 */
export function decideScrollProbe(input: ScrollProbeInput): boolean {
  const { rect, last, offsets, intersects, paintMovesWithContent } = input;
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
    // Scrolling down (positive dTop) moves in-flow content up, so a co-moving
    // viewport rect has rect.top - baseRect.top === -dTop. Require the exact
    // opposite sign for both axes before trusting the opt-in proof.
    const movedWithContent =
      paintMovesWithContent?.(scroller) === true &&
      sameSize &&
      Math.abs(rect.top - baseRect.top + dTop) < MOVE_EPSILON &&
      Math.abs(rect.left - baseRect.left + dLeft) < MOVE_EPSILON;
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
  /** Cost of this task's first point (the layout/style flush). */
  firstStepCostMs: number;
  /** Last completed task's first-point cost, used to predict a spill. */
  lastFirstStepCostMs: number;
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
  batchOffsets = null;
  scrollBatchActive = false;
  batchCursor = 0;
}

function onScroll(event: Event): void {
  activeScrollers.add(event.target);
  for (const entry of entries.values()) entry.scrollPending = true;
  scheduleBatch();
}

function clearTrailing(entry: TargetEntry): void {
  if (entry.trailing === undefined) return;
  window.clearTimeout(entry.trailing);
  entry.trailing = undefined;
}

function onGenericTrigger(event?: Event, urgent = true): void {
  // Mutations/resizes may have changed what elements paint; the probe's
  // per-node background analysis cache must not outlive that.
  invalidateBackdropPaintInfo();
  for (const entry of entries.values()) {
    if (event?.type === 'visibilitychange') { entry.task?.return?.(); entry.task = null; }
    if (urgent) { entry.task?.return?.(); entry.task = null; entry.urgent = true; }
    // An urgent trigger must not sit behind a throttle timer that was already
    // superseded. tryRun still applies the throttle floor, but a stale timer
    // would otherwise keep the entry out of hasRunnableWork until it fires.
    if (urgent || event?.type === 'visibilitychange') clearTrailing(entry);
    entry.needsRun = true;
  }
  scheduleBatch();
}

function onMutations(records: MutationRecord[]): void {
  const batch = classifyMutations(records);
  if (!batch.real) return;
  // Light/Dark flips animate the tint: wait for the transition to settle so
  // probes read the final colour instead of the intermediate one. A real paint
  // change in the same batch must not be swallowed by that wait: apply it now
  // and schedule the settled probe as well, so the final tint is still checked.
  if (batch.lightFlip) scheduleSettledTrigger();
  if (batch.urgent) {
    onGenericTrigger(undefined, true);
  } else if (!batch.lightFlip) {
    // Style-only mutations are often transforms; still invalidate the paint
    // cache and compare colours during the next actual sample, but with the
    // normal rather than paint-change slice.
    onGenericTrigger(undefined, false);
  }
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

/**
 * Cost to assume before starting this entry. A completed cheap grid can be
 * predicted exactly; an expensive one is still allowed to start when its
 * first measured point fits, because the remaining points can be split across
 * frames. This keeps a single known-expensive first hit-test from blocking a
 * second target without starving that target forever.
 */
function expectedRunCost(entry: TargetEntry): number {
  if (entry.task) {
    return Math.max(
      entry.lastProbeCostMs,
      entry.firstStepCostMs || entry.lastFirstStepCostMs,
    );
  }
  if (entry.lastRunCostMs > 0) {
    return entry.lastRunCostMs <= PROBE_BUDGET_MS
      ? entry.lastRunCostMs
      : Math.max(entry.lastFirstStepCostMs, entry.lastProbeCostMs);
  }
  return 0;
}

function runBatch(frameTime?: number): void {
  rafId = 0;
  if (document.hidden) return;
  if (consumeBackdropPaintChange()) promotePaintChange();
  const startedAt = now();
  // `requestAnimationFrame` reports when the frame began. If a long task
  // delayed this callback, the remaining slice is smaller, so probe work cannot
  // push an already late frame even further behind.
  const frameStart =
    typeof frameTime === 'number' && Number.isFinite(frameTime) && frameTime > 0
      ? Math.min(frameTime, startedAt)
      : startedAt;
  // Reading scrollY can flush layout. A wholly throttled batch must do no DOM
  // reads; take the shared snapshot lazily on its first real probe/scroll check.
  scrollBatchActive = true;
  try {
    withBackdropProbeBatch(() => {
      // Paint-urgent entries go first so a stale motion queue cannot hold a
      // real background change behind ordinary scroll work. Within each group
      // the cursor still rotates, so no surface monopolizes every frame.
      const urgent: TargetEntry[] = [];
      const normal: TargetEntry[] = [];
      for (const entry of entries.values()) (entry.urgent ? urgent : normal).push(entry);
      const work = urgent.concat(normal);
      if (!work.length) return;
      const first = batchCursor % work.length;
      let ranProbe = false;
      let frameProbeCostMs = 0;
      for (let checked = 0; checked < work.length; checked++) {
        const index = (first + checked) % work.length;
        const entry = work[index];
        // A target can unsubscribe (React cleanup) while this batch runs.
        if (entries.get(entry.target) !== entry) continue;
        if (!entry.needsRun && !entry.scrollPending && !entry.task) continue;
        batchCursor = index;
        // A single budget bounds the whole frame, not each target. Urgent paint
        // work is allowed the larger slice; everything else stops at 6 ms.
        const budget = entry.urgent ? PROBE_PAINT_BUDGET_MS : PROBE_BUDGET_MS;
        if (now() - frameStart > budget) break;
        if (entry.scrollPending) decideScroll(entry);
        if (entry.task || (entry.needsRun && entry.trailing === undefined)) {
          // A slow native hit-test is indivisible. Learn its cost and avoid
          // starting a second expensive probe that would overrun this frame.
          // Unmeasured work uses a small floor so cheap first probes can still
          // pack together without inviting several unknown native calls into
          // an almost-spent frame. Unlike the old loop, do not stop the frame
          // here: advance the cursor so the next frame services later
          // subscribers before this grid resumes. That prevents a slow grid
          // from starving every other one.
          if (ranProbe) {
            const predicted = expectedRunCost(entry) ||
              Math.max(PROBE_UNMEASURED_ESTIMATE_MS, frameProbeCostMs);
            if (now() - frameStart + predicted > budget) break;
          }
          const probeStart = now();
          const ran = tryRun(entry, frameStart);
          if (ran) {
            ranProbe = true;
            frameProbeCostMs = Math.max(frameProbeCostMs, now() - probeStart);
          }
        }
        batchCursor = (index + 1) % work.length;
      }
    });
  } finally { batchOffsets = null; scrollBatchActive = false; }
  if (hasRunnableWork()) scheduleBatch();
}

function tryRun(entry: TargetEntry, frameStart: number): boolean {
  const resuming = entry.task !== null;
  const budget = entry.urgent
    ? PROBE_PAINT_BUDGET_MS
    : resuming ? PROBE_CATCHUP_BUDGET_MS : PROBE_BUDGET_MS;
  let deadline = frameStart + budget;
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
      entry.firstStepCostMs = 0;
    }
  }
  if (entry.task) {
    let ran = false;
    while (entry.task) {
      // The first point after a frame boundary includes a layout/style flush;
      // its cost overestimates subsequent points sharing this batch's DOM reads.
      // Let that first point run, then use the cost actually measured for the
      // continuation. Never cap the prediction below the last measured point:
      // doing so appends a second known-expensive sample and overruns the slice.
      const predicted = resuming
        ? entry.continuationCostMs || entry.lastProbeCostMs
        : entry.lastProbeCostMs;
      if (now() >= deadline || (ran && now() + predicted > deadline)) break;
      const start = now();
      const step = entry.task.next();
      const cost = now() - start;
      if (ran) entry.continuationCostMs = cost;
      entry.taskCostMs += cost;
      if (entry.taskSteps === 0) entry.firstStepCostMs = cost;
      if (consumeBackdropPaintChange()) {
        // A fresh first sample already reads the new paint. A partly sampled
        // old grid must restart so a black-to-white switch cannot average stale
        // black samples into the new result. next() has returned, so cancellation
        // cannot re-enter a running generator.
        const keep = !step.done && entry.taskSteps === 0;
        promotePaintChange(keep ? entry : undefined);
        deadline = frameStart + PROBE_PAINT_BUDGET_MS;
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
          while (!next.done) {
            entry.taskSteps++;
            // A formerly cheap grid can slow down mid-drain. Allow that one
            // indivisible point to overrun, but never start another after the
            // deadline: the remaining points resume under the normal slice.
            if (now() >= deadline) break;
            next = entry.task.next();
          }
          entry.taskCostMs += now() - drainStart;
          if (next.done) completeTask(entry);
          else entry.lastProbeCostMs = Math.max(entry.lastProbeCostMs, now() - drainStart);
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
    entry.lastFirstStepCostMs = entry.lastProbeCostMs;
    entry.urgent = false;
    return true;
  }
}

function completeTask(entry: TargetEntry): void {
  entry.task = null;
  entry.urgent = false;
  entry.lastRunCostMs = Math.max(0.001, entry.taskCostMs);
  entry.lastStepCount = entry.taskSteps;
  entry.lastFirstStepCostMs = entry.firstStepCostMs;
  entry.firstStepCostMs = 0;
  refreshCheck(entry);
}

function promotePaintChange(keep?: TargetEntry): void {
  for (const entry of entries.values()) {
    entry.urgent = true;
    // A stale partial result must not be held behind a throttle timer while
    // newer paint is waiting; tryRun applies the throttle floor on the retry.
    clearTrailing(entry);
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

/**
 * True when the rect can show pixels. Offscreen surfaces keep their last
 * decision; re-probing them on every scroll is pure waste and can starve
 * visible surfaces. The scroll that brings one back into view triggers a
 * fresh decision with the new rect. If the viewport cannot be measured
 * (SSR/test stubs), stay conservative and probe.
 */
function rectIntersectsViewport(rect: ScrollRect): boolean {
  const width = window.innerWidth;
  const height = window.innerHeight;
  if (!(width > 0) || !(height > 0)) return true;
  if (!(rect.width > 0) || !(rect.height > 0)) return false;
  return rect.top < height && rect.top + rect.height > 0 &&
    rect.left < width && rect.left + rect.width > 0;
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
  if (!rectIntersectsViewport(rect)) return;
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
    firstStepCostMs: 0,
    lastFirstStepCostMs: 0,
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
    existing.task = null;
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
