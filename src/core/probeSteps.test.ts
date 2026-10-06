import { expect, it, vi } from 'vitest';
import { consumeBackdropPaintChange, probeBackdropLight, probeBackdropLightSteps, probeMembersBackdropLightSteps, withBackdropProbeBatch } from './backdropProbe';

function fixture() {
  let background = 'rgb(255 255 255)', internal = false;
  const rect = { left:0,top:0,right:200,bottom:100,width:200,height:100 };
  const paint = { tagName:'DIV',getAttribute:()=>internal?'style':null,getBoundingClientRect:vi.fn(()=>rect) };
  const unknown = { tagName:'VIDEO',getBoundingClientRect:vi.fn(()=>rect) };
  const html = { tagName:'HTML',getBoundingClientRect:()=>rect };
  const getComputedStyle = vi.fn((node:unknown)=>({ backgroundColor:node===paint ? background : 'rgb(0 0 0)', backgroundImage:'none',backgroundSize:'auto',backgroundPosition:'0% 0%',visibility:'visible',display:'block' }));
  const win = { innerWidth:400,innerHeight:300,getComputedStyle };
  const el = { tagName:'DIV',isConnected:true,getBoundingClientRect:()=>rect,contains:()=>false,ownerDocument:null as unknown };
  const doc = { defaultView:win,body:null,documentElement:html,elementsFromPoint:vi.fn(()=>[el,paint,unknown,html]) };
  el.ownerDocument=doc;
  return { el:el as unknown as HTMLElement, paint, unknown, doc, setBackground:(value:string)=>{background=value;},setInternal:()=>{internal=true;} };
}

it('ignores unreadable content hidden below opaque paint',()=>{
  const f=fixture();expect(probeBackdropLight(f.el)?.averageLuminance).toBe(1);
  expect(f.doc.elementsFromPoint).toHaveBeenCalledTimes(9);
  expect(f.unknown.getBoundingClientRect).not.toHaveBeenCalled();
});

it('keeps all nine samples and reads fresh paint after a suspended frame',()=>{
  const f=fixture(), steps=probeBackdropLightSteps(f.el);
  let result:ReturnType<typeof steps.next>;
  for(let i=0;i<9;i++) {
    if(i===3)f.setBackground('rgb(0 0 0)');
    withBackdropProbeBatch(()=>{result=steps.next();});
    expect(result!.done).toBe(false);expect(f.doc.elementsFromPoint).toHaveBeenCalledTimes(i+1);
  }
  withBackdropProbeBatch(()=>{result=steps.next();});
  expect(result!.done).toBe(true);expect(result!.value?.averageLuminance).toBe(1/3);
  expect(f.paint.getBoundingClientRect).toHaveBeenCalledTimes(9);
});

it('preserves the synchronous area-weighted group result when drained',()=>{
  const f=fixture(), steps=probeMembersBackdropLightSteps([f.el]);
  let result:ReturnType<typeof steps.next>;
  withBackdropProbeBatch(()=>{do {result=steps.next();}while(!result.done);});
  expect(result!.value?.averageLuminance).toBe(1);expect(f.doc.elementsFromPoint).toHaveBeenCalledTimes(9);
});

it('does not reuse a suspended cache after nested batches return',()=>{
  const f=fixture(),steps=probeBackdropLightSteps(f.el);
  withBackdropProbeBatch(()=>{steps.next();withBackdropProbeBatch(()=>{});steps.next();});
  f.setBackground('rgb(0 0 0)');
  let result:ReturnType<typeof steps.next>;
  do {withBackdropProbeBatch(()=>{result=steps.next();});}while(!result!.done);
  expect(result!.value?.averageLuminance).toBe(2/9);
});

it('reports real paint changes once while ignoring the library tint transition',()=>{
  consumeBackdropPaintChange();const f=fixture();probeBackdropLight(f.el);
  expect(consumeBackdropPaintChange()).toBe(false);
  f.setBackground('rgb(0 0 0)');probeBackdropLight(f.el);
  expect(consumeBackdropPaintChange()).toBe(true);expect(consumeBackdropPaintChange()).toBe(false);
  probeBackdropLight(f.el);expect(consumeBackdropPaintChange()).toBe(false);
  f.setInternal();f.setBackground('rgb(255 255 255)');probeBackdropLight(f.el);
  expect(consumeBackdropPaintChange()).toBe(false);
});
