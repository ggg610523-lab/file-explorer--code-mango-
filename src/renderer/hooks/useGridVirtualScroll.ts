import { useState, useRef, useLayoutEffect, useMemo } from 'react';

interface UseGridVirtualScrollOptions {
  itemCount: number;
  iconSize: number;
  overscan?: number;
}

interface GridDims {
  w: number;
  h: number;
  scrollTop: number;
}

const GRID_GAP_X = 4;
const GRID_PADDING_X = 12;

function computeCols(w: number, iconSize: number): number {
  const colW = iconSize >= 64 ? Math.max(iconSize + 60, 120) : Math.max(iconSize + 44, 90);
  return w > 0 ? Math.max(1, Math.floor((w - GRID_PADDING_X * 2 + GRID_GAP_X) / (colW + GRID_GAP_X))) : 1;
}

export function useGridVirtualScroll({ itemCount, iconSize, overscan = 4 }: UseGridVirtualScrollOptions) {
  const [dims, setDims] = useState<GridDims>({ w: 0, h: 0, scrollTop: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const lastRef = useRef({ cols: -1, start: -1, end: -1 });

  const rowHeight = iconSize + 40;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || itemCount === 0) return;

    const commit = () => {
      rafRef.current = 0;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const scrollTop = el.scrollTop;
      const cols = computeCols(w, iconSize);
      const totalRows = Math.ceil(itemCount / cols);
      const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
      const endRow = Math.min(totalRows, Math.ceil((scrollTop + h) / rowHeight) + overscan);
      const start = startRow * cols;
      const end = Math.min(itemCount, endRow * cols);
      const last = lastRef.current;
      if (last.cols === cols && last.start === start && last.end === end) return;
      last.cols = cols;
      last.start = start;
      last.end = end;
      setDims({ w, h, scrollTop });
    };

    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(commit);
    };

    lastRef.current = { cols: -1, start: -1, end: -1 };
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
  }, [itemCount, iconSize, overscan, rowHeight]);

  const colsPerRow = itemCount === 0 ? 1 : computeCols(dims.w, iconSize);
  const totalRows = Math.ceil(itemCount / colsPerRow);
  const totalHeight = totalRows * rowHeight + GRID_PADDING_X * 2;

  const visibleStartRow = Math.max(0, Math.floor(dims.scrollTop / rowHeight) - overscan);
  const visibleEndRow = Math.min(totalRows, Math.ceil((dims.scrollTop + dims.h) / rowHeight) + overscan);

  const visibleStartIndex = visibleStartRow * colsPerRow;
  const visibleEndIndex = Math.min(itemCount, visibleEndRow * colsPerRow);
  const offsetY = visibleStartRow * rowHeight;

  const visibleRange = useMemo(
    () => ({ start: visibleStartIndex, end: visibleEndIndex }),
    [visibleStartIndex, visibleEndIndex]
  );

  if (itemCount === 0) {
    return { containerRef, visibleRange: { start: 0, end: 0 }, offsetY: 0, totalHeight: 0, colsPerRow: 1, rowHeight };
  }

  return { containerRef, visibleRange, offsetY, totalHeight, colsPerRow, rowHeight };
}
