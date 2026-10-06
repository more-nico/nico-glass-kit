import { describe, expect, it, vi } from 'vitest';
import { probeBackdropLight, withBackdropProbeBatch } from './backdropProbe';

describe('frame-local backdrop reads', () => {
  it('shares reads within a batch and refreshes colour/geometry after it ends, including exceptions', () => {
    const rect = { left:0,top:0,right:200,bottom:100,width:200,height:100 };
    let background = 'rgb(255 255 255)';
    const paint = { tagName:'DIV',getBoundingClientRect:vi.fn(()=>rect) };
    const html = { tagName:'HTML',getBoundingClientRect:()=>rect };
    const getComputedStyle = vi.fn((node:unknown)=>({ backgroundColor: node===paint ? background : 'rgb(0 0 0)',backgroundImage:'none',backgroundSize:'auto',backgroundPosition:'0% 0%',visibility:'visible',display:'block' }));
    const win = {innerWidth:400,innerHeight:300,getComputedStyle};
    const el = { tagName:'DIV',getBoundingClientRect:()=>rect,contains:()=>false,ownerDocument:null as unknown };
    const doc = {defaultView:win,body:null,documentElement:html,elementsFromPoint:()=>[el,paint,html]};el.ownerDocument=doc;
    const probe=()=>probeBackdropLight(el as unknown as HTMLElement);
    withBackdropProbeBatch(()=>{expect(probe()?.averageLuminance).toBe(1);expect(probe()?.averageLuminance).toBe(1);});
    expect(getComputedStyle.mock.calls.filter(([node])=>node===paint)).toHaveLength(1);
    expect(paint.getBoundingClientRect).toHaveBeenCalledTimes(1);
    background='rgb(0 0 0)';expect(probe()?.averageLuminance).toBe(0);
    expect(paint.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(()=>withBackdropProbeBatch(()=>{probe();throw Error('stop');})).toThrow('stop');
    background='rgb(255 255 255)';expect(probe()?.averageLuminance).toBe(1);
  });
});
