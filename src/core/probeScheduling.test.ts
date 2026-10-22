import { afterEach, expect, it, vi } from 'vitest';
import { invalidateProbe, subscribeProbe, type ProbeTarget } from './backdropProbeScheduler';

type ObserverCallback = (records: MutationRecord[], observer: MutationObserver) => void;

// All scheduling cases use the same fake browser and clock; only probe costs and
// frame timestamps differ. The scheduler owns module-level state, so every test
// unsubscribes all targets (which also clears listeners, timers and rAF work).
function environment() {
  vi.useFakeTimers();
  const clock = { now: 1000 };
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let scrollY = 0;
  let scrollX = 0;
  const scrollRead = vi.fn(() => scrollY);
  const scrollXRead = vi.fn(() => scrollX);
  const rectRead = vi.fn(() => ({ left: 0, top: 0, width: 20, height: 20 }));
  class ElementStub extends EventTarget {
    isConnected = true;
    scrollTop = 0;
    scrollLeft = 0;
    getBoundingClientRect = rectRead;
  }
  const win = Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
    innerWidth: 800,
    innerHeight: 600,
  });
  Object.defineProperty(win, 'scrollY', { get: scrollRead });
  Object.defineProperty(win, 'scrollX', { get: scrollXRead });
  let observerCallback: ObserverCallback | null = null;
  class MutationObserverStub {
    constructor(callback: ObserverCallback) {
      observerCallback = callback;
    }
    observe = vi.fn();
    disconnect = vi.fn();
  }
  const doc = Object.assign(new EventTarget(), {
    hidden: false,
    documentElement: new ElementStub(),
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', ElementStub);
  vi.stubGlobal('performance', { now: () => clock.now });
  vi.stubGlobal('MutationObserver', MutationObserverStub);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = (timestamp = clock.now) => {
    const work = [...frames.values()];
    frames.clear();
    work.forEach((callback) => callback(timestamp));
  };
  const emitMutations = (records: MutationRecord[]) => {
    observerCallback?.(records, {} as MutationObserver);
  };
  const setScroll = (top: number, left = 0) => {
    scrollY = top;
    scrollX = left;
  };
  return {
    clock,
    frames,
    scrollRead,
    scrollXRead,
    rectRead,
    ElementStub,
    doc,
    win,
    flush,
    emitMutations,
    setScroll,
  };
}

function pageMutation(
  type: MutationRecordType,
  target: Element,
  attributeName?: string,
): MutationRecord {
  return { type, target, attributeName } as unknown as MutationRecord;
}

function fakeMutationTarget(zone: string | null): Element {
  const zoneNode = zone === null ? null : { getAttribute: () => zone };
  return {
    closest: (selector: string) => (selector === '[data-ngs-internal]' ? zoneNode : null),
  } as unknown as Element;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('keeps a wholly throttled batch free of DOM reads and polling', () => {
  const { clock, frames, scrollRead, rectRead, ElementStub, flush } = environment();
  const target: ProbeTarget = { el: new ElementStub() as unknown as HTMLElement, run: vi.fn() };
  const unsubscribe = subscribeProbe(target);
  try {
    flush();
    expect(target.run).toHaveBeenCalledTimes(1);

    vi.mocked(target.run).mockClear();
    scrollRead.mockClear();
    rectRead.mockClear();
    clock.now += 1;
    invalidateProbe(target);
    flush(); // Throttled: no frame work, no layout reads, just one trailing timer.
    expect(target.run).not.toHaveBeenCalled();
    expect(scrollRead).not.toHaveBeenCalled();
    expect(rectRead).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);

    vi.advanceTimersByTime(120);
    clock.now += 120;
    flush();
    expect(target.run).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  } finally {
    unsubscribe();
  }
});

it('does not start a second known-expensive probe in the same 6 ms slice', () => {
  const { clock, frames, ElementStub, flush } = environment();
  const calls = [0, 0];
  const targets: ProbeTarget[] = calls.map((_, index) => ({
    el: new ElementStub() as unknown as HTMLElement,
    run: vi.fn(() => {
      clock.now += 5;
      calls[index]++;
    }),
  }));
  const unsubs = targets.map(subscribeProbe);
  try {
    // Learn the 5 ms cost; unmeasured targets are admitted one frame at a time.
    for (let frame = 0; frame < 4; frame++) {
      clock.now += 16;
      flush();
    }
    expect(frames.size).toBe(0);
    calls.fill(0);

    clock.now += 130;
    const start = clock.now;
    targets.forEach(invalidateProbe);
    flush();
    expect(clock.now - start).toBe(5);
    expect(calls).toEqual([1, 0]); // Second 5 ms probe would overrun 6 ms.
    expect(frames.size).toBe(1);

    // The cursor advanced, so the deferred surface runs next instead of the
    // first surface monopolizing every frame.
    clock.now += 130;
    calls.fill(0);
    targets.forEach(invalidateProbe);
    flush();
    expect(calls).toEqual([0, 1]);
  } finally {
    unsubs.forEach((unsubscribe) => unsubscribe());
  }
});

it('rotates slow nine-point grids, commits all points and resumes after visibility', () => {
  const { clock, frames, ElementStub, doc, flush } = environment();
  const commits = [0, 0];
  const aborts = [0, 0];
  let hits = 0;
  const targets: ProbeTarget[] = commits.map((_, index) => ({
    el: new ElementStub() as unknown as HTMLElement,
    run: () => {
      throw Error('must stream');
    },
    *createTask() {
      let completed = false;
      try {
        for (let point = 0; point < 9; point++) {
          clock.now += 4;
          hits++;
          yield;
        }
        commits[index]++;
        completed = true;
      } finally {
        if (!completed) aborts[index]++;
      }
    },
  }));
  const unsubs = targets.map(subscribeProbe);
  try {
    // A 4 ms point does not fit twice in 6 ms. Rotation gives both surfaces a
    // point per frame instead of letting one grid monopolize the queue.
    for (let frame = 0; frame < 40 && commits.some((count) => count === 0); frame++) {
      clock.now += 16;
      targets.forEach(invalidateProbe);
      const start = clock.now;
      const before = hits;
      flush();
      expect(clock.now - start).toBeLessThanOrEqual(6);
      expect(hits - before).toBeLessThanOrEqual(1);
    }
    expect(commits).toEqual([1, 1]);

    // Start partial work, hide the tab, then verify cancellation and that the
    // pending rAF cannot keep polling while hidden.
    clock.now += 130;
    targets.forEach(invalidateProbe);
    flush();
    const beforeHide = [...commits];
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    flush();
    expect(commits).toEqual(beforeHide);
    expect(frames.size).toBe(0);
    expect(aborts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);

    // Becoming visible re-arms urgent 8 ms slices; both grids finish.
    doc.hidden = false;
    clock.now += 130;
    doc.dispatchEvent(new Event('visibilitychange'));
    for (let frame = 0; frame < 40 && commits.some((count) => count < 2); frame++) {
      clock.now += 16;
      flush();
    }
    expect(commits).toEqual([2, 2]);
    expect(frames.size).toBe(0);
  } finally {
    unsubs.forEach((unsubscribe) => unsubscribe());
  }
});

it('rechecks a suddenly slow first point before taking the fast path', () => {
  const { clock, frames, ElementStub, flush } = environment();
  let cost = 1 / 9;
  let commits = 0;
  const target: ProbeTarget = {
    el: new ElementStub() as unknown as HTMLElement,
    run: vi.fn(),
    *createTask() {
      for (let point = 0; point < 9; point++) {
        clock.now += cost;
        yield;
      }
      commits++;
    },
  };
  const unsubscribe = subscribeProbe(target);
  try {
    flush();
    expect(commits).toBe(1);
    expect(frames.size).toBe(0);

    clock.now += 130;
    cost = 4;
    invalidateProbe(target);
    const start = clock.now;
    flush();
    // The formerly cheap grid is now measured at 4 ms per point: one point
    // fits the 6 ms slice; the rest resume instead of draining blindly.
    expect(clock.now - start).toBe(4);
    expect(frames.size).toBe(1);
    for (let frame = 0; frame < 10 && commits === 1; frame++) {
      clock.now += 16;
      flush();
    }
    expect(commits).toBe(2);
    expect(frames.size).toBe(0);
  } finally {
    unsubscribe();
  }
});

it('measures the slice from the animation-frame timestamp, not callback start', () => {
  const { clock, frames, ElementStub, flush } = environment();
  let hits = 0;
  let commits = 0;
  const target: ProbeTarget = {
    el: new ElementStub() as unknown as HTMLElement,
    run: () => {
      throw Error('must stream');
    },
    *createTask() {
      for (let point = 0; point < 9; point++) {
        clock.now += 4;
        hits++;
        yield;
      }
      commits++;
    },
  };
  const unsubscribe = subscribeProbe(target);
  try {
    // The frame began 20 ms ago: its slice is already spent, so start no
    // native hit-test even though this callback just started.
    flush(clock.now - 20);
    expect(hits).toBe(0);
    expect(frames.size).toBe(1);
    clock.now += 16;
    flush();
    expect(hits).toBeGreaterThan(0);
    for (let frame = 0; frame < 12 && commits === 0; frame++) {
      clock.now += 16;
      flush();
    }
    expect(commits).toBe(1);
    expect(hits).toBe(9);
  } finally {
    unsubscribe();
  }
});

it('cancels partial grids and trailing timers on unmount', () => {
  const { clock, frames, ElementStub, flush } = environment();
  let hits = 0;
  let completed = false;
  const target: ProbeTarget = {
    el: new ElementStub() as unknown as HTMLElement,
    run: () => {
      throw Error('must stream');
    },
    *createTask() {
      try {
        for (let point = 0; point < 9; point++) {
          clock.now += 4;
          hits++;
          yield;
        }
        completed = true;
      } finally {
        if (!completed) hits = -1;
      }
    },
  };
  const unsubscribe = subscribeProbe(target);
  try {
    flush();
    expect(hits).toBe(1);
    expect(frames.size).toBe(1);
    unsubscribe();
    expect(hits).toBe(-1);
    expect(frames.size).toBe(0);
  } finally {
    unsubscribe();
  }

  // A trailing throttle timer must not wake a removed target either.
  const second: ProbeTarget = { el: new ElementStub() as unknown as HTMLElement, run: vi.fn() };
  const unsubscribeSecond = subscribeProbe(second);
  try {
    flush();
    clock.now += 1;
    invalidateProbe(second);
    flush(); // Throttled: arms a trailing timer instead of probing.
    expect(second.run).toHaveBeenCalledTimes(1);
    unsubscribeSecond();
    vi.advanceTimersByTime(200);
    flush();
    expect(second.run).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  } finally {
    unsubscribeSecond();
  }
});

it('gives real paint mutations an 8 ms slice and restarts stale work', () => {
  const { clock, frames, ElementStub, flush, emitMutations } = environment();
  let hits = 0;
  let commits = 0;
  let completedSamples = 0;
  const target: ProbeTarget = {
    el: new ElementStub() as unknown as HTMLElement,
    run: () => {
      throw Error('must stream');
    },
    *createTask() {
      let samples = 0;
      for (let point = 0; point < 9; point++) {
        clock.now += 2;
        hits++;
        samples++;
        yield;
      }
      completedSamples = samples;
      commits++;
    },
  };
  const unsubscribe = subscribeProbe(target);
  try {
    // Normal 6 ms slice: three 2 ms points, leaving a partial grid.
    flush();
    expect(hits).toBe(3);
    expect(commits).toBe(0);
    expect(frames.size).toBe(1);

    // A real class swap is urgent: cancel the stale partial grid and restart
    // with an 8 ms slice (four 2 ms points) that is still sub-frame.
    clock.now += 130;
    const page = fakeMutationTarget(null);
    emitMutations([pageMutation('attributes', page, 'class')]);
    const start = clock.now;
    flush();
    expect(clock.now - start).toBe(8);
    expect(hits).toBe(7);
    expect(commits).toBe(0);
    expect(frames.size).toBe(1);

    for (let frame = 0; frame < 5 && commits === 0; frame++) {
      clock.now += 16;
      flush();
    }
    expect(commits).toBe(1);
    expect(completedSamples).toBe(9); // Full nine-point result after restart.
    expect(hits).toBe(12); // Three stale points from the cancelled grid + nine.
    expect(frames.size).toBe(0);
  } finally {
    unsubscribe();
  }
});

it('ignores HUD-internal text/level churn but still follows real page paint', () => {
  const { clock, frames, ElementStub, flush, emitMutations } = environment();
  const target: ProbeTarget = { el: new ElementStub() as unknown as HTMLElement, run: vi.fn() };
  const unsubscribe = subscribeProbe(target);
  try {
    flush();
    vi.mocked(target.run).mockClear();

    clock.now += 130;
    const hud = fakeMutationTarget('all');
    emitMutations([
      pageMutation('childList', hud), // textContent rewrite
      pageMutation('attributes', hud, 'data-level'),
    ]);
    flush();
    expect(target.run).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);

    // The marker is scoped to the HUD: a page class swap outside it still
    // starts an urgent probe.
    clock.now += 130;
    emitMutations([pageMutation('attributes', fakeMutationTarget(null), 'class')]);
    flush();
    expect(target.run).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
  }
});
