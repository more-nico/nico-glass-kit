import { describe, expect, it } from 'vitest';
import {
  GlyphTaskScheduler,
  type SchedulerSource,
  type SchedulerWorker,
  type TaskRunMessage,
} from './rasterWorkerScheduler';

class FakeWorker implements SchedulerWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly messages: TaskRunMessage<number>[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.messages.push(message as TaskRunMessage<number>);
  }

  reply(output: string): void {
    const run = this.messages[this.messages.length - 1];
    if (!run) return;
    this.onmessage?.({
      data: { type: 'done', jobId: run.jobId, revision: run.revision, output },
    } as MessageEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

interface TransferInput {
  glyphs: Array<{ coverage: Uint8ClampedArray }>;
}

/**
 * Uses the real structured-clone transfer algorithm, so the submitted buffers
 * are genuinely detached after `postMessage` (unlike a fake that keeps the
 * object by reference).
 */
class CloningWorker implements SchedulerWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly runs: TaskRunMessage<TransferInput>[] = [];
  terminated = false;

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const cloned = structuredClone(message, { transfer }) as TaskRunMessage<TransferInput>;
    this.runs.push(cloned);
  }

  reply(output: string): void {
    const run = this.runs[this.runs.length - 1];
    if (!run) return;
    this.onmessage?.({
      data: { type: 'done', jobId: run.jobId, revision: run.revision, output },
    } as MessageEvent);
  }

  fail(): void {
    this.onerror?.({} as ErrorEvent);
  }

  terminate(): void {
    this.terminated = true;
  }
}

interface Delivery {
  owner: string;
  revision: number;
  output: string;
  source: SchedulerSource;
}

function createHarness(options: {
  createWorker?: () => SchedulerWorker | null;
  fallback?: (input: number, isCancelled?: () => boolean) => Promise<string>;
} = {}) {
  const workers: FakeWorker[] = [];
  const deliveries: Delivery[] = [];
  const failures: unknown[] = [];
  const scheduler = new GlyphTaskScheduler<number, string>(
    options.createWorker ?? (() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }),
    options.fallback ?? (async (input) => `fallback:${input}`),
    2,
  );
  const submit = (owner: string, revision: number, input: number, signature = String(input)) => {
    scheduler.submit({
      owner,
      revision,
      signature,
      input,
      deliver: (deliveredRevision, output, source) => {
        deliveries.push({ owner, revision: deliveredRevision, output, source });
      },
      fail: (error) => failures.push(error),
    });
  };
  return { scheduler, workers, deliveries, failures, submit };
}

async function flush(times = 24): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('glyph raster scheduler', () => {
  it('keeps one latest queued task per owner and drops superseded results', () => {
    const h = createHarness();
    h.submit('A', 1, 1, 'one');
    h.submit('A', 2, 2, 'two');
    h.submit('A', 3, 3, 'three');

    expect(h.workers).toHaveLength(1);
    expect(h.workers[0].messages).toHaveLength(1);
    expect(h.scheduler.stats().queued).toBe(1);
    expect(h.scheduler.stats().droppedPending).toBe(1);

    // The running job is revision 1; revision 1 lost the race to 3.
    h.workers[0].reply('one-result');
    expect(h.deliveries).toEqual([]);
    expect(h.scheduler.stats().staleResults).toBe(1);
    expect(h.workers[0].messages).toHaveLength(2);

    h.workers[0].reply('three-result');
    expect(h.deliveries).toEqual([
      { owner: 'A', revision: 3, output: 'three-result', source: 'worker' },
    ]);
  });

  it('creates at most two workers and queues further owners', () => {
    const h = createHarness();
    h.submit('A', 1, 1);
    h.submit('B', 1, 2);
    h.submit('C', 1, 3);

    expect(h.workers).toHaveLength(2);
    expect(h.workers.map((worker) => worker.messages.length)).toEqual([1, 1]);
    expect(h.scheduler.stats().activeWorkers).toBe(2);
    expect(h.scheduler.stats().queued).toBe(1);

    h.workers[0].reply('a');
    expect(h.workers[0].messages).toHaveLength(2);
    expect(h.deliveries.map((entry) => entry.owner)).toEqual(['A']);

    h.workers[1].reply('b');
    h.workers[0].reply('c');
    expect(h.deliveries.map((entry) => `${entry.owner}:${entry.output}`)).toEqual([
      'A:a',
      'B:b',
      'C:c',
    ]);
    expect(h.workers).toHaveLength(2);
  });

  it('cancels an unmounted owner and terminates the last worker', () => {
    const h = createHarness();
    h.submit('A', 1, 1);
    h.submit('A', 2, 2);
    h.submit('B', 1, 3);

    h.scheduler.cancelOwner('A');
    expect(h.scheduler.stats().owners).toBe(1);
    expect(h.scheduler.stats().droppedPending).toBe(1);

    h.workers[0].reply('stale-a');
    expect(h.deliveries).toEqual([]);
    expect(h.scheduler.stats().staleResults).toBe(1);

    h.scheduler.cancelOwner('B');
    expect(h.scheduler.isDisposed()).toBe(true);
    expect(h.scheduler.stats().workersTerminated).toBe(2);
    expect(h.workers.every((worker) => worker.terminated)).toBe(true);

    const submitted = h.scheduler.stats().submitted;
    h.scheduler.submit({
      owner: 'A',
      revision: 3,
      signature: 'late',
      input: 4,
      deliver: () => undefined,
    });
    expect(h.scheduler.stats().submitted).toBe(submitted);
  });

  it('runs the latest revision on the main-thread fallback when no worker exists', async () => {
    const h = createHarness({ createWorker: () => null });
    h.submit('A', 1, 1, 'one');
    h.submit('A', 2, 2, 'two');
    await flush();

    expect(h.workers).toHaveLength(0);
    expect(h.deliveries).toEqual([
      { owner: 'A', revision: 2, output: 'fallback:2', source: 'fallback' },
    ]);
    expect(h.scheduler.stats().workersCreated).toBe(0);
    expect(h.scheduler.stats().fallbacks).toBe(2);
    expect(h.scheduler.stats().staleResults).toBe(1);
  });

  it('runs a failed-over task on the fallback, not a worker re-post of detached input', async () => {
    const workers: CloningWorker[] = [];
    const fallbackInputs: TransferInput[] = [];
    const deliveries: Array<{ owner: string; revision: number; output: string; source: SchedulerSource }> = [];
    let releaseFirstFallback: (() => void) | null = null;

    const scheduler = new GlyphTaskScheduler<TransferInput, string>(
      () => {
        const worker = new CloningWorker();
        workers.push(worker);
        return worker;
      },
      async (input) => {
        fallbackInputs.push(input);
        const marker = input.glyphs[0].coverage[0];
        if (marker === 1) {
          await new Promise<void>((resolve) => {
            releaseFirstFallback = resolve;
          });
        }
        return `fallback:${marker}`;
      },
    );

    const submit = (owner: string, marker: number) => {
      const workerCoverage = new Uint8ClampedArray([marker, marker, marker, marker]);
      const fallbackCoverage = workerCoverage.slice();
      scheduler.submit({
        owner,
        revision: 1,
        signature: `task-${marker}`,
        input: { glyphs: [{ coverage: workerCoverage }] },
        fallbackInput: { glyphs: [{ coverage: fallbackCoverage }] },
        transfer: [workerCoverage.buffer],
        deliver: (revision, output, source) => deliveries.push({ owner, revision, output, source }),
      });
      return workerCoverage;
    };

    const first = submit('A', 1);
    submit('B', 2);
    expect(workers).toHaveLength(2);
    expect(first.byteLength).toBe(0);

    // B completes, leaving worker 2 idle while A is still running.
    workers[1].reply('b-result');
    await flush(4);

    // A fails; its fallback starts and blocks until we release it.
    workers[0].fail();
    await flush(4);
    expect(fallbackInputs).toHaveLength(1);
    expect(Array.from(fallbackInputs[0].glyphs[0].coverage)).toEqual([1, 1, 1, 1]);
    expect(releaseFirstFallback).not.toBeNull();

    // C starts on the idle worker and its buffer is really transferred.
    const third = submit('C', 3);
    expect(workers[1].runs).toHaveLength(2);
    expect(third.byteLength).toBe(0);

    // C also errors while the fallback is busy. The old bug requeued C with
    // detached input; it must now wait for the fallback with fallbackInput.
    workers[1].fail();
    await flush(4);
    expect(fallbackInputs).toHaveLength(1);

    releaseFirstFallback!();
    await flush(24);

    expect(fallbackInputs).toHaveLength(2);
    expect(Array.from(fallbackInputs[1].glyphs[0].coverage)).toEqual([3, 3, 3, 3]);
    expect(deliveries).toEqual([
      { owner: 'B', revision: 1, output: 'b-result', source: 'worker' },
      { owner: 'A', revision: 1, output: 'fallback:1', source: 'fallback' },
      { owner: 'C', revision: 1, output: 'fallback:3', source: 'fallback' },
    ]);
    // No worker was re-created to re-post C's detached input.
    expect(workers).toHaveLength(2);
    expect(scheduler.stats().activeWorkers).toBe(0);
    expect(scheduler.stats().queued).toBe(0);
  });
});
