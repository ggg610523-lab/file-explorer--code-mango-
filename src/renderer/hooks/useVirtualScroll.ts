import { useState, useRef, useLayoutEffect, useMemo } from 'react';

interface UseVirtualScrollOptions {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
}

interface VsDims {
  h: number;
  scrollTop: number;
}

export function useVirtualScroll({ itemCount, itemHeight, overscan = 5 }: UseVirtualScrollOptions) {
  const [dims, setDims] = useState<VsDims>({ h: 0, scrollTop: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const lastRef = useRef({ start: -1, end: -1 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const commit = () => {
      rafRef.current = 0;
      const h = el.clientHeight;
      const scrollTop = el.scrollTop;
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
      const end = Math.min(itemCount, Math.ceil((scrollTop + h) / itemHeight) + overscan);
      const last = lastRef.current;
      if (last.start === start && last.end === end) return;
      last.start = start;
      last.end = end;
      setDims({ h, scrollTop });
    };

    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(commit);
    };

    lastRef.current = { start: -1, end: -1 };
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    el.addEventListener('scroll', schedule, { passive: true });
    commit();

    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', schedule);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [itemCount, itemHeight, overscan]);

  const totalHeight = itemCount * itemHeight;

  const visibleStartIndex = Math.max(0, Math.floor(dims.scrollTop / itemHeight) - overscan);
  const visibleEndIndex = Math.min(itemCount, Math.ceil((dims.scrollTop + dims.h) / itemHeight) + overscan);

  const offsetY = visibleStartIndex * itemHeight;

  const visibleItems = useMemo(
    () => ({ start: visibleStartIndex, end: visibleEndIndex }),
    [visibleStartIndex, visibleEndIndex]
  );

  return {
    containerRef,
    visibleRange: visibleItems,
    totalHeight,
    offsetY,
    scrollTop: dims.scrollTop,
  };
}
