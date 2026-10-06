import { expect, it, vi } from 'vitest';
import { cancelGlassFrame, requestGlassFrame } from './animationFrame';

it('batches native frames, defers new work, and cancels pending/in-frame work independently',()=>{
  const frames=new Map<number,FrameRequestCallback>();let id=0;
  const request=vi.fn((callback:FrameRequestCallback)=>{frames.set(++id,callback);return id;});
  vi.stubGlobal('requestAnimationFrame',request);vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  try {
    const run=vi.fn();const requests=Array.from({length:500},()=>requestGlassFrame(run));
    expect(request).toHaveBeenCalledTimes(1);cancelGlassFrame(requests[5]);
    const flush=()=>{const batch=[...frames.values()];frames.clear();for(const cb of batch)cb(123);};
    flush();expect(run).toHaveBeenCalledTimes(499);expect(frames.size).toBe(0);
    const next=vi.fn(),later=vi.fn();let canceled=0;
    requestGlassFrame(()=>{requestGlassFrame(next);cancelGlassFrame(canceled);});
    canceled=requestGlassFrame(later);flush();expect(next).not.toHaveBeenCalled();expect(later).not.toHaveBeenCalled();
    flush();expect(next).toHaveBeenCalledWith(123);
    const disposable=requestGlassFrame(run);cancelGlassFrame(disposable);expect(frames.size).toBe(0);
  } finally {vi.unstubAllGlobals();}
});

it('reports a callback error without stopping other surfaces',()=>{
  let frame:FrameRequestCallback|undefined;
  const errors:Array<()=>void>=[];
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frame=callback;return 1;});
  vi.stubGlobal('cancelAnimationFrame',()=>{});vi.stubGlobal('queueMicrotask',(callback:()=>void)=>errors.push(callback));
  try {
    const next=vi.fn();requestGlassFrame(()=>{throw Error('broken spring');});requestGlassFrame(next);
    frame!(123);expect(next).toHaveBeenCalledWith(123);expect(errors).toHaveLength(1);
    expect(()=>errors[0]()).toThrow('broken spring');
  } finally {vi.unstubAllGlobals();}
});
