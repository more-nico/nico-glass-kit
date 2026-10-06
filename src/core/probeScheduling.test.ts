import { expect, it, vi } from 'vitest';
import { invalidateProbe, subscribeProbe, type ProbeTarget } from './backdropProbeScheduler';

it('keeps throttled batches idle and budgets expensive probes fairly under continuous invalidation', () => {
  vi.useFakeTimers();
  let time = 1000, nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const scrollRead = vi.fn(() => 0);
  const rectRead = vi.fn(() => ({ left:0,top:0,width:20,height:20 }));
  class ElementStub extends EventTarget { isConnected = true; getBoundingClientRect = rectRead; }
  const win = Object.assign(new EventTarget(), { setTimeout,clearTimeout });
  Object.defineProperty(win, 'scrollY', { get:scrollRead }); Object.defineProperty(win, 'scrollX', { get:() => 0 });
  const doc = Object.assign(new EventTarget(), { hidden:false,documentElement:new ElementStub() });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('Element', ElementStub);
  vi.stubGlobal('performance', { now:() => time });
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (cb:FrameRequestCallback) => {frames.set(++nextFrame, cb);return nextFrame;});
  vi.stubGlobal('cancelAnimationFrame', (id:number) => frames.delete(id));
  const targets:ProbeTarget[] = Array.from({length:5},() => ({ el:new ElementStub() as unknown as HTMLElement,run:vi.fn() }));
  const unsubs = targets.map(subscribeProbe);
  const flush = () => {const callbacks=[...frames.values()];frames.clear();for(const cb of callbacks)cb(time);};
  try {
    scrollRead.mockClear(); flush(); expect(scrollRead).toHaveBeenCalledTimes(1);
    for(const target of targets) expect(target.run).toHaveBeenCalledTimes(1);
    scrollRead.mockClear(); rectRead.mockClear(); time++;
    for(const target of targets) invalidateProbe(target);
    flush(); expect(scrollRead).not.toHaveBeenCalled(); expect(rectRead).not.toHaveBeenCalled();
    expect(frames.size).toBe(0); // one trailing timeout per target, no polling

    // Learn an indivisible 4ms native probe. A 6ms budget must not start two
    // of these per frame once their cost is known. Continuous mutations must
    // not keep serving only the first subscribers.
    for(const target of targets) vi.mocked(target.run).mockImplementation(()=>{time+=4;});
    time+=200; vi.advanceTimersByTime(120);
    for(let i=0;frames.size && i<10;i++){time+=20;flush();}
    for(const target of targets) expect(target.run).toHaveBeenCalledTimes(2);
    for(let i=0;i<5;i++) {
      const before=targets.reduce((sum,target)=>sum+vi.mocked(target.run).mock.calls.length,0);
      time+=130;for(const target of targets)invalidateProbe(target);flush();
      expect(targets.reduce((sum,target)=>sum+vi.mocked(target.run).mock.calls.length,0)).toBe(before+1);
    }
    for(const target of targets) expect(target.run).toHaveBeenCalledTimes(3);
  } finally {for(const unsubscribe of unsubs)unsubscribe();vi.unstubAllGlobals();vi.useRealTimers();}
});

it('splits slow grids between frames, commits all nine points and cancels hidden/unmounted work',()=>{
  vi.useFakeTimers();let time=1000,id=0;
  const frames=new Map<number,FrameRequestCallback>();
  class ElementStub extends EventTarget { isConnected=true;getBoundingClientRect=()=>({left:0,top:0,width:20,height:20}); }
  const doc=Object.assign(new EventTarget(),{hidden:false,documentElement:new ElementStub()});
  vi.stubGlobal('window',Object.assign(new EventTarget(),{setTimeout,clearTimeout,scrollY:0,scrollX:0}));
  vi.stubGlobal('document',doc);vi.stubGlobal('Element',ElementStub);vi.stubGlobal('performance',{now:()=>time});
  vi.stubGlobal('MutationObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++id,cb);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const commits=[0,0],aborts=[0,0];let hits=0;
  const targets:ProbeTarget[]=commits.map((_,index)=>({el:new ElementStub() as unknown as HTMLElement,run:()=>{throw Error('must stream');},*createTask(){
    let completed=false;
    try {for(let point=0;point<9;point++){time+=4;hits++;yield;}commits[index]++;completed=true;}
    finally {if(!completed)aborts[index]++;}
  }}));
  const unsubs=targets.map(subscribeProbe);
  const flush=()=>{const work=[...frames.values()];frames.clear();for(const callback of work)callback(time);};
  try {
    for(let frame=0;frame<30 && commits.some(count=>count===0);frame++) {
      time+=16;vi.advanceTimersByTime(16);targets.forEach(invalidateProbe);
      const start=time,before=hits;flush();expect(time-start).toBeLessThanOrEqual(16);expect(hits-before).toBeLessThanOrEqual(4);
    }
    expect(commits).toEqual([1,1]);
    time+=130;targets.forEach(invalidateProbe);flush();
    const before=[...commits];doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));flush();
    expect(commits).toEqual(before);expect(frames.size).toBe(0);expect(aborts.reduce((a,b)=>a+b,0)).toBeGreaterThan(0);
  } finally {unsubs.forEach(unsubscribe=>unsubscribe());vi.unstubAllGlobals();vi.useRealTimers();}
});

it('keeps cheap grids in one frame but rechecks a suddenly slow first point',()=>{
  vi.useFakeTimers();let time=1000,id=0,cost=1/9;
  const frames=new Map<number,FrameRequestCallback>();
  class ElementStub extends EventTarget {isConnected=true;getBoundingClientRect=()=>({left:0,top:0,width:20,height:20});}
  vi.stubGlobal('window',Object.assign(new EventTarget(),{setTimeout,clearTimeout,scrollY:0,scrollX:0}));
  vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false,documentElement:new ElementStub()}));
  vi.stubGlobal('Element',ElementStub);vi.stubGlobal('performance',{now:()=>time});
  vi.stubGlobal('MutationObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++id,cb);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const run=vi.fn(()=>{time+=1;}),task=vi.fn(function*(){for(let i=0;i<9;i++){time+=cost;yield;}});
  const target:ProbeTarget={el:new ElementStub() as unknown as HTMLElement,run,createTask:task};
  const unsubscribe=subscribeProbe(target),flush=()=>{const work=[...frames.values()];frames.clear();work.forEach(cb=>cb(time));};
  try {
    flush();expect(task).toHaveBeenCalledTimes(1);expect(run).not.toHaveBeenCalled();
    time+=130;invalidateProbe(target);flush();expect(run).not.toHaveBeenCalled();expect(task).toHaveBeenCalledTimes(2);expect(frames.size).toBe(0);
    time+=130;cost=4;invalidateProbe(target);const start=time;flush();
    expect(time-start).toBe(4);expect(frames.size).toBe(1);
  } finally {unsubscribe();vi.unstubAllGlobals();vi.useRealTimers();}
});

it('amortizes the expensive first point after layout changes instead of repeating it for every sample',()=>{
  vi.useFakeTimers();let time=1000,id=0,fresh=true,hits=0,commits=0;
  const frames=new Map<number,FrameRequestCallback>();
  class ElementStub extends EventTarget {isConnected=true;getBoundingClientRect=()=>({left:0,top:0,width:20,height:20});}
  vi.stubGlobal('window',Object.assign(new EventTarget(),{setTimeout,clearTimeout,scrollY:0,scrollX:0}));
  vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false,documentElement:new ElementStub()}));
  vi.stubGlobal('Element',ElementStub);vi.stubGlobal('performance',{now:()=>time});
  vi.stubGlobal('MutationObserver',class {observe(){}disconnect(){}});
  vi.stubGlobal('requestAnimationFrame',(cb:FrameRequestCallback)=>{frames.set(++id,cb);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  const target:ProbeTarget={el:new ElementStub() as unknown as HTMLElement,run:()=>{throw Error('must stream');},*createTask(){
    for(let point=0;point<9;point++){time+=fresh?6:1;fresh=false;hits++;yield;}commits++;
  }};
  const unsubscribe=subscribeProbe(target);
  try {
    for(let frame=0;frame<3;frame++) {
      time+=16;fresh=true;const start=time,work=[...frames.values()];frames.clear();work.forEach(cb=>cb(time));
      expect(time-start).toBeLessThanOrEqual(16);
      if(frame===0)expect(hits).toBe(1); // first slow point still yields immediately
    }
    expect(hits).toBe(9);expect(commits).toBe(1);expect(frames.size).toBe(0);
  } finally {unsubscribe();vi.unstubAllGlobals();vi.useRealTimers();}
});
