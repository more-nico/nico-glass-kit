import { afterEach, expect, it, vi } from 'vitest';
import { invalidateProbe, subscribeProbe, type ProbeTarget } from './backdropProbeScheduler';

// All scheduling cases use the same fake browser and clock; only probe costs differ.
function environment() {
  vi.useFakeTimers();
  const clock = { now: 1000 };
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const scrollRead = vi.fn(() => 0);
  const rectRead = vi.fn(() => ({ left: 0, top: 0, width: 20, height: 20 }));
  class ElementStub extends EventTarget { isConnected = true; getBoundingClientRect = rectRead; }
  const win = Object.assign(new EventTarget(), { setTimeout, clearTimeout, scrollX: 0 });
  Object.defineProperty(win, 'scrollY', { get: scrollRead });
  const doc = Object.assign(new EventTarget(), { hidden: false, documentElement: new ElementStub() });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('Element', ElementStub);
  vi.stubGlobal('performance', { now: () => clock.now });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () => {
    const work = [...frames.values()]; frames.clear();
    work.forEach(callback => callback(clock.now));
  };
  return { clock, frames, scrollRead, rectRead, ElementStub, doc, flush };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('keeps throttled batches idle and budgets expensive probes fairly under continuous invalidation', () => {
  const { clock, frames, scrollRead, rectRead, ElementStub, flush } = environment();
  const targets:ProbeTarget[] = Array.from({length:5},() => ({ el:new ElementStub() as unknown as HTMLElement,run:vi.fn() }));
  const unsubs = targets.map(subscribeProbe);
  try {
    scrollRead.mockClear(); flush(); expect(scrollRead).toHaveBeenCalledTimes(1);
    for(const target of targets) expect(target.run).toHaveBeenCalledTimes(1);
    scrollRead.mockClear(); rectRead.mockClear(); clock.now++;
    for(const target of targets) invalidateProbe(target);
    flush(); expect(scrollRead).not.toHaveBeenCalled(); expect(rectRead).not.toHaveBeenCalled();
    expect(frames.size).toBe(0); // one trailing timeout per target, no polling

    // Learn an indivisible 4ms native probe. A 6ms budget must not start two
    // of these per frame once their cost is known. Continuous mutations must
    // not keep serving only the first subscribers.
    for(const target of targets) vi.mocked(target.run).mockImplementation(()=>{clock.now+=4;});
    clock.now+=200; vi.advanceTimersByTime(120);
    for(let i=0;frames.size && i<10;i++){clock.now+=20;flush();}
    for(const target of targets) expect(target.run).toHaveBeenCalledTimes(2);
    for(let i=0;i<5;i++) {
      const before=targets.reduce((sum,target)=>sum+vi.mocked(target.run).mock.calls.length,0);
      clock.now+=130;for(const target of targets)invalidateProbe(target);flush();
      expect(targets.reduce((sum,target)=>sum+vi.mocked(target.run).mock.calls.length,0)).toBe(before+1);
    }
    for(const target of targets) expect(target.run).toHaveBeenCalledTimes(3);
  } finally {for(const unsubscribe of unsubs)unsubscribe();}
});

it('splits slow grids between frames, commits all nine points and cancels hidden/unmounted work',()=>{
  const { clock, frames, ElementStub, doc, flush } = environment();
  const commits=[0,0],aborts=[0,0];let hits=0;
  const targets:ProbeTarget[]=commits.map((_,index)=>({el:new ElementStub() as unknown as HTMLElement,run:()=>{throw Error('must stream');},*createTask(){
    let completed=false;
    try {for(let point=0;point<9;point++){clock.now+=4;hits++;yield;}commits[index]++;completed=true;}
    finally {if(!completed)aborts[index]++;}
  }}));
  const unsubs=targets.map(subscribeProbe);
  try {
    for(let frame=0;frame<30 && commits.some(count=>count===0);frame++) {
      clock.now+=16;vi.advanceTimersByTime(16);targets.forEach(invalidateProbe);
      const start=clock.now,before=hits;flush();expect(clock.now-start).toBeLessThanOrEqual(16);expect(hits-before).toBeLessThanOrEqual(4);
    }
    expect(commits).toEqual([1,1]);
    clock.now+=130;targets.forEach(invalidateProbe);flush();
    const before=[...commits];doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));flush();
    expect(commits).toEqual(before);expect(frames.size).toBe(0);expect(aborts.reduce((a,b)=>a+b,0)).toBeGreaterThan(0);
  } finally {unsubs.forEach(unsubscribe=>unsubscribe());}
});

it('keeps cheap grids in one frame but rechecks a suddenly slow first point',()=>{
  const { clock, frames, ElementStub, flush } = environment();
  let cost = 1 / 9;
  const run=vi.fn(()=>{clock.now+=1;}),task=vi.fn(function*(){for(let i=0;i<9;i++){clock.now+=cost;yield;}});
  const target:ProbeTarget={el:new ElementStub() as unknown as HTMLElement,run,createTask:task};
  const unsubscribe=subscribeProbe(target);
  try {
    flush();expect(task).toHaveBeenCalledTimes(1);expect(run).not.toHaveBeenCalled();
    clock.now+=130;invalidateProbe(target);flush();expect(run).not.toHaveBeenCalled();expect(task).toHaveBeenCalledTimes(2);expect(frames.size).toBe(0);
    clock.now+=130;cost=4;invalidateProbe(target);const start=clock.now;flush();
    expect(clock.now-start).toBe(4);expect(frames.size).toBe(1);
  } finally {unsubscribe();}
});

it('amortizes the expensive first point after layout changes instead of repeating it for every sample',()=>{
  const { clock, frames, ElementStub, flush } = environment();
  let fresh = true, hits = 0, commits = 0;
  const target:ProbeTarget={el:new ElementStub() as unknown as HTMLElement,run:()=>{throw Error('must stream');},*createTask(){
    for(let point=0;point<9;point++){clock.now+=fresh?6:1;fresh=false;hits++;yield;}commits++;
  }};
  const unsubscribe=subscribeProbe(target);
  try {
    for(let frame=0;frame<3;frame++) {
      clock.now+=16;fresh=true;const start=clock.now;flush();
      expect(clock.now-start).toBeLessThanOrEqual(16);
      if(frame===0)expect(hits).toBe(1); // first slow point still yields immediately
    }
    expect(hits).toBe(9);expect(commits).toBe(1);expect(frames.size).toBe(0);
  } finally {unsubscribe();}
});
