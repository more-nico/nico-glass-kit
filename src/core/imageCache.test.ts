import {expect,it,vi} from 'vitest';
import {createBackdropImageCache} from './imageCache';

it('bounds entries and bytes, respects recency and replaces pending costs',()=>{
  const dispose=vi.fn(),cache=createBackdropImageCache<number>((_,size)=>size,dispose,3,10);
  cache.set('a',3);cache.set('b',3);cache.set('c',3);cache.get('a');cache.set('d',3);
  expect(cache.get('b')).toBeUndefined();expect(dispose).toHaveBeenCalledWith('b',3);
  cache.set('a',8);expect(cache.stats()).toEqual({size:1,bytes:8,evictions:3});
});
it('keeps one oversized live background without an unbounded cache or decode loop',()=>{
  const cache=createBackdropImageCache<number>((_,size)=>size,()=>{},3,10);
  cache.set('huge',100);expect(cache.get('huge')).toBe(100);expect(cache.stats().size).toBe(1);
  cache.set('next',2);expect(cache.get('huge')).toBeUndefined();expect(cache.stats().bytes).toBe(2);
});
