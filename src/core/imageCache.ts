/** Bounded LRU for decoded backgrounds; retain one oversized image to avoid decode loops. */
export function createBackdropImageCache<T>(estimate: (key: string, value: T) => number,
  dispose: (key: string, value: T) => void, limit = 32, budget = 64 * 1024 * 1024) {
  const entries = new Map<string, { value:T; bytes:number }>();
  let bytes=0, evictions=0;
  return {
    get(key:string):T|undefined {
      const entry=entries.get(key);
      if (!entry) return;
      entries.delete(key); entries.set(key,entry); return entry.value;
    },
    set(key:string,value:T):void {
      const previous=entries.get(key);
      if (previous) { bytes-=previous.bytes;entries.delete(key); }
      const entry={value,bytes:estimate(key,value)};entries.set(key,entry);bytes+=entry.bytes;
      while(entries.size>1 && (entries.size>limit || bytes>budget)) {
        const oldest=entries.keys().next().value!;
        const removed=entries.get(oldest)!;entries.delete(oldest);bytes-=removed.bytes;evictions++;
        dispose(oldest,removed.value);
      }
    },
    stats:()=>({size:entries.size,bytes,evictions}),
  };
}
