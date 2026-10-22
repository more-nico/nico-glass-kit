/**
 * Latest-task scheduler for the glyph raster workers.
 *
 * Invariants:
 *  - at most two workers (created lazily, on demand);
 *  - each owner (one mounted GlassText) has at most one queued task — a newer
 *    revision replaces the queued one instead of growing a backlog;
 *  - a result is delivered only while its task is still the owner's latest;
 *    revisions that lost the race are counted and dropped;
 *  - `cancelOwner` (unmount) removes every task for that owner and terminates
 *    the workers once the last owner is gone;
 *  - without Worker/OffscreenCanvas/CSP permission the same input is run by
 *    the injected asynchronous fallback, so behaviour degrades but never
 *    disappears.
 *
 * The scheduler is DOM-free and dependency-injected so the scheduling rules
 * can be unit-tested without a real worker.
 */

export interface SchedulerWorker {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export type SchedulerWorkerFactory = () => SchedulerWorker | null;

export type SchedulerSource = 'worker' | 'fallback';

export interface SchedulerTask<TInput, TOutput> {
  owner: string;
  revision: number;
  /**
   * Identity of the work itself (glyph keys + sizes). A re-submit with the
   * same signature while the task is still in flight is retargeted to the
   * newer revision instead of re-running identical work.
   */
  signature: string;
  input: TInput;
  /**
   * Input that remains valid after `transfer` detaches buffers in `input`.
   * Required whenever `transfer` is non-empty: a worker error after
   * `postMessage` must still be able to run the main-thread fallback.
   */
  fallbackInput?: TInput;
  transfer?: Transferable[];
  deliver: (revision: number, output: TOutput, source: SchedulerSource) => void;
  fail?: (error: unknown) => void;
}

export interface SchedulerStats {
  workersCreated: number;
  workersTerminated: number;
  submitted: number;
  started: number;
  delivered: number;
  deduped: number;
  droppedPending: number;
  staleResults: number;
  fallbacks: number;
  failed: number;
  activeWorkers: number;
  queued: number;
  owners: number;
}

export interface TaskRunMessage<TInput> {
  type: 'run';
  jobId: number;
  revision: number;
  input: TInput;
}

export type TaskReply<TOutput> =
  | { type: 'done'; jobId: number; revision: number; output: TOutput }
  | { type: 'error'; jobId: number; revision: number; message: string };

interface WorkerSlot<TInput, TOutput> {
  worker: SchedulerWorker;
  busy: InternalTask<TInput, TOutput> | null;
}

interface InternalTask<TInput, TOutput> extends SchedulerTask<TInput, TOutput> {
  jobId: number;
}

const emptyStats = (): SchedulerStats => ({
  workersCreated: 0,
  workersTerminated: 0,
  submitted: 0,
  started: 0,
  delivered: 0,
  deduped: 0,
  droppedPending: 0,
  staleResults: 0,
  fallbacks: 0,
  failed: 0,
  activeWorkers: 0,
  queued: 0,
  owners: 0,
});

export class GlyphTaskScheduler<TInput, TOutput> {
  private readonly workers: WorkerSlot<TInput, TOutput>[] = [];
  private readonly queue: InternalTask<TInput, TOutput>[] = [];
  /**
   * Tasks whose transferred `input` can no longer be re-posted/run. They are
   * completed through the fallback only, in submission order, and never go
   * back through the worker queue.
   */
  private readonly fallbackQueue: InternalTask<TInput, TOutput>[] = [];
  private readonly pending = new Map<string, InternalTask<TInput, TOutput>>();
  private readonly latest = new Map<string, InternalTask<TInput, TOutput>>();
  private readonly maxWorkers: number;
  private readonly counters = emptyStats();
  private jobSequence = 0;
  private fallbackBusy = false;
  private fallbackTask: InternalTask<TInput, TOutput> | null = null;
  private workerDisabled = false;
  private consecutiveWorkerFailures = 0;
  private disposed = false;

  constructor(
    private readonly createWorker: SchedulerWorkerFactory,
    private readonly fallback: (input: TInput, isCancelled: () => boolean) => Promise<TOutput>,
    maxWorkers = 2,
  ) {
    this.maxWorkers = Math.min(2, Math.max(1, Math.floor(maxWorkers)));
  }

  stats(): SchedulerStats {
    return {
      ...this.counters,
      activeWorkers: this.workers.length,
      queued: this.queue.length + this.fallbackQueue.length,
      owners: this.latest.size,
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  isWorkerDisabled(): boolean {
    return this.workerDisabled;
  }

  /**
   * Queues (or retargets) the owner's latest task. The previous queued task
   * for the same owner is dropped; a running identical payload is retargeted
   * so its result is still accepted for the newer revision.
   */
  submit(task: SchedulerTask<TInput, TOutput>): void {
    if (this.disposed) {
      task.fail?.(new Error('nico-glass-kit: glyph raster scheduler is disposed'));
      return;
    }

    if (task.transfer && task.transfer.length > 0 && task.fallbackInput === undefined) {
      task.fail?.(new Error(
        'nico-glass-kit: a transferring glyph task needs a detached-safe fallbackInput',
      ));
      return;
    }

    const current = this.latest.get(task.owner);
    if (current && task.revision < current.revision) {
      this.counters.droppedPending++;
      return;
    }

    if (current && current.signature === task.signature && this.isInFlight(current)) {
      current.revision = task.revision;
      current.deliver = task.deliver;
      current.fail = task.fail;
      this.counters.deduped++;
      return;
    }

    this.counters.submitted++;
    if (current && this.pending.get(current.owner) === current) {
      this.removeQueued(current);
      this.counters.droppedPending++;
    } else if (current && this.fallbackQueue.includes(current)) {
      this.removeFallbackQueued(current);
      this.counters.droppedPending++;
    }

    const next: InternalTask<TInput, TOutput> = { ...task, jobId: 0 };
    this.latest.set(next.owner, next);
    this.pending.set(next.owner, next);
    this.queue.push(next);
    this.pump();
  }

  /** Unmount: forget the owner's latest revision and release its work. */
  cancelOwner(owner: string): void {
    // Normally `pending` holds the single queued task, but a worker-error
    // failover can briefly requeue a task; scan the queue so cancellation is
    // exhaustive and no stale owner work can start after unmount.
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i];
      if (task.owner !== owner) continue;
      this.queue.splice(i, 1);
      this.counters.droppedPending++;
    }
    for (let i = this.fallbackQueue.length - 1; i >= 0; i--) {
      if (this.fallbackQueue[i].owner !== owner) continue;
      this.fallbackQueue.splice(i, 1);
      this.counters.droppedPending++;
    }
    this.pending.delete(owner);
    this.latest.delete(owner);
    // Running tasks cannot be aborted mid-EDT, but their result is now
    // guaranteed to be discarded by `finish`. If this was the last owner,
    // terminate immediately to release the worker and its caches.
    if (this.latest.size === 0 && this.pending.size === 0) this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.workers) {
      this.counters.workersTerminated++;
      try {
        slot.worker.terminate();
      } catch {
        // Termination is best-effort; the result is discarded regardless.
      }
    }
    this.workers.length = 0;
    this.queue.length = 0;
    this.fallbackQueue.length = 0;
    this.pending.clear();
    this.latest.clear();
    this.fallbackTask = null;
  }

  private isInFlight(task: InternalTask<TInput, TOutput>): boolean {
    if (this.pending.get(task.owner) === task) return true;
    if (this.fallbackQueue.includes(task)) return true;
    if (this.fallbackTask === task) return true;
    for (const slot of this.workers) if (slot.busy === task) return true;
    return false;
  }

  private removeQueued(task: InternalTask<TInput, TOutput>): void {
    const index = this.queue.indexOf(task);
    if (index >= 0) this.queue.splice(index, 1);
    if (this.pending.get(task.owner) === task) this.pending.delete(task.owner);
  }

  private removeFallbackQueued(task: InternalTask<TInput, TOutput>): void {
    const index = this.fallbackQueue.indexOf(task);
    if (index >= 0) this.fallbackQueue.splice(index, 1);
  }

  private isOwnerRunning(owner: string): boolean {
    if (this.fallbackTask?.owner === owner) return true;
    return this.workers.some((slot) => slot.busy?.owner === owner);
  }

  private pruneStale(): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const task = this.queue[i];
      if (this.latest.get(task.owner) === task) continue;
      this.queue.splice(i, 1);
      if (this.pending.get(task.owner) === task) this.pending.delete(task.owner);
      this.counters.droppedPending++;
    }
  }

  private pruneStaleFallback(): void {
    for (let i = this.fallbackQueue.length - 1; i >= 0; i--) {
      if (this.latest.get(this.fallbackQueue[i].owner) === this.fallbackQueue[i]) continue;
      this.fallbackQueue.splice(i, 1);
      this.counters.droppedPending++;
    }
  }

  /** First queued task whose owner is not already computing a revision. */
  private nextRunnableIndex(): number {
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      if (this.latest.get(task.owner) !== task) continue;
      if (this.isOwnerRunning(task.owner)) continue;
      return i;
    }
    return -1;
  }

  private pump(): void {
    if (this.disposed) return;
    this.pruneStale();

    while (this.queue.length > 0) {
      const index = this.nextRunnableIndex();
      if (index < 0) break;
      const slot = this.acquireSlot();
      if (!slot) break;
      const [task] = this.queue.splice(index, 1);
      if (this.pending.get(task.owner) === task) this.pending.delete(task.owner);
      this.start(slot, task);
      this.pruneStale();
    }

    this.pruneStaleFallback();
    if (!this.fallbackBusy) {
      if (this.fallbackQueue.length > 0) {
        this.startNextFallback();
      } else if (this.queue.length > 0 && this.workerDisabled) {
        this.startNextFallback();
      }
    }
  }

  private acquireSlot(): WorkerSlot<TInput, TOutput> | null {
    const idle = this.workers.find((slot) => slot.busy === null);
    if (idle) return idle;
    if (this.workers.length >= this.maxWorkers || this.workerDisabled) return null;

    let worker: SchedulerWorker | null = null;
    try {
      worker = this.createWorker();
    } catch {
      worker = null;
    }
    if (!worker) {
      // CSP / missing Worker / missing OffscreenCanvas: stay on the main
      // thread from now on rather than throwing once per task.
      this.workerDisabled = true;
      return null;
    }

    const slot: WorkerSlot<TInput, TOutput> = { worker, busy: null };
    worker.onmessage = (event) => this.handleReply(slot, event.data);
    worker.onerror = () => this.handleWorkerFailure(slot);
    worker.onmessageerror = () => this.handleWorkerFailure(slot);
    this.workers.push(slot);
    this.counters.workersCreated++;
    return slot;
  }

  private start(slot: WorkerSlot<TInput, TOutput>, task: InternalTask<TInput, TOutput>): void {
    task.jobId = ++this.jobSequence;
    slot.busy = task;
    this.counters.started++;
    try {
      slot.worker.postMessage({
        type: 'run',
        jobId: task.jobId,
        revision: task.revision,
        input: task.input,
      } satisfies TaskRunMessage<TInput>, task.transfer ?? []);
    } catch (error) {
      slot.busy = null;
      this.removeWorker(slot);
      this.failover(task, error);
    }
  }

  private removeWorker(slot: WorkerSlot<TInput, TOutput>): void {
    const index = this.workers.indexOf(slot);
    if (index >= 0) this.workers.splice(index, 1);
    this.counters.workersTerminated++;
    try {
      slot.worker.terminate();
    } catch {
      // Best-effort.
    }
  }

  private handleReply(slot: WorkerSlot<TInput, TOutput>, data: unknown): void {
    const task = slot.busy;
    if (!task) {
      this.counters.staleResults++;
      return;
    }
    const reply = data as Partial<TaskReply<TOutput>> | null;
    if (!reply || reply.jobId !== task.jobId) {
      this.counters.staleResults++;
      return;
    }
    slot.busy = null;
    this.consecutiveWorkerFailures = 0;
    if (reply.type === 'done') {
      this.finish(task, reply.output as TOutput, 'worker');
    } else if (reply.type === 'error') {
      this.failover(task, new Error(reply.message || 'glyph raster worker failed'));
    } else {
      this.failover(task, new Error('glyph raster worker returned an unknown reply'));
    }
    this.pump();
  }

  private handleWorkerFailure(slot: WorkerSlot<TInput, TOutput>): void {
    const task = slot.busy;
    slot.busy = null;
    this.removeWorker(slot);
    this.consecutiveWorkerFailures++;
    // A CSP/blocked worker can construct successfully and fail on load. Stop
    // re-creating it after two failures and run the same work on the main
    // thread instead.
    if (this.consecutiveWorkerFailures >= 2) this.workerDisabled = true;
    if (task) this.failover(task, new Error('glyph raster worker failed'));
    this.pump();
  }

  private finish(
    task: InternalTask<TInput, TOutput>,
    output: TOutput,
    source: SchedulerSource,
  ): void {
    if (this.disposed || this.latest.get(task.owner) !== task) {
      this.counters.staleResults++;
      return;
    }
    this.counters.delivered++;
    try {
      task.deliver(task.revision, output, source);
    } catch (error) {
      this.counters.failed++;
      task.fail?.(error);
    }
  }

  private failover(task: InternalTask<TInput, TOutput>, error: unknown): void {
    if (this.disposed || this.latest.get(task.owner) !== task) {
      this.counters.staleResults++;
      return;
    }
    if (this.fallbackBusy) {
      // A worker error after `postMessage` may have detached `task.input`
      // buffers. Never put it back on the worker queue; queue it for the
      // fallback, which uses the detached-safe `fallbackInput`.
      if (!this.fallbackQueue.includes(task)) this.fallbackQueue.push(task);
      return;
    }
    void error;
    this.startFallback(task);
  }

  private startNextFallback(): void {
    this.pruneStale();
    this.pruneStaleFallback();

    // Fallback-queued tasks always go through the fallback: their worker
    // input may have been detached by an earlier postMessage.
    let index = this.fallbackQueue.findIndex((task) =>
      this.latest.get(task.owner) === task && !this.isOwnerRunning(task.owner));
    if (index >= 0) {
      const [task] = this.fallbackQueue.splice(index, 1);
      // Defensive: a failed-over task normally has no pending entry, but keep
      // the map consistent if a caller requeued it before the worker error.
      if (this.pending.get(task.owner) === task) this.pending.delete(task.owner);
      this.startFallback(task);
      return;
    }
    if (!this.workerDisabled) return;

    index = this.nextRunnableIndex();
    if (index < 0) return;
    const [task] = this.queue.splice(index, 1);
    if (this.pending.get(task.owner) === task) this.pending.delete(task.owner);
    this.startFallback(task);
  }

  private startFallback(task: InternalTask<TInput, TOutput>): void {
    this.fallbackBusy = true;
    this.fallbackTask = task;
    this.counters.started++;
    this.counters.fallbacks++;
    // `input` may be detached by a postMessage transfer; only the explicit
    // fallback snapshot is guaranteed to still own its coverage buffers.
    const fallbackInput = task.fallbackInput ?? task.input;
    void Promise.resolve()
      .then(() => this.fallback(
        fallbackInput,
        () => this.disposed || this.latest.get(task.owner) !== task,
      ))
      .then((output) => {
        if (this.disposed) return;
        this.finish(task, output, 'fallback');
      })
      .catch((error: unknown) => {
        if (this.disposed) return;
        if (this.latest.get(task.owner) === task) {
          this.counters.failed++;
          task.fail?.(error);
        } else {
          this.counters.staleResults++;
        }
      })
      .then(() => {
        if (this.disposed) return;
        this.fallbackBusy = false;
        this.fallbackTask = null;
        this.pump();
      });
  }
}
