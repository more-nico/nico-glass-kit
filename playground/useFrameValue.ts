import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

/** Pointer bursts replace pending input instead of rebuilding every intermediate material. */
export function useFrameValue<T>(commit: Dispatch<SetStateAction<T>>): (value: T) => void {
  const pending = useRef<T | null>(null);
  const frame = useRef(0);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  return useCallback((value: T) => {
    pending.current = value;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = pending.current;
      pending.current = null;
      if (next !== null) commit(next);
    });
  }, [commit]);
}
