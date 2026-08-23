import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from 'react';
import { FileItem, ViewMode } from '../types';
import { SystemIcon, isImage } from './SystemIcon';
import { prefetchThumbnail } from '../thumbnailManager';
import { useVirtualScroll } from '../hooks/useVirtualScroll';
import { useGridVirtualScroll } from '../hooks/useGridVirtualScroll';

interface Props {
  files: FileItem[];
  loading: boolean;
  viewMode: ViewMode;
  selectedFiles: Set<string>;
  onSelect: (path: string, multi: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onOpen: (path: string, isDir: boolean) => void;
  onRename: (path: string, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, item: FileItem | null) => void;
  isSearching: boolean;
  animKey: number;
  pendingRename?: string | null;
  onPendingRenameHandled?: () => void;
  onDragStart?: (e: React.DragEvent, item: FileItem | null) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragOverItem?: (e: React.DragEvent, item: FileItem) => void;
  onDragLeaveItem?: () => void;
  onDropOnItem?: (e: React.DragEvent, item: FileItem) => void;
  onDropOnBg?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  dropTarget?: string | null;
}

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  const u = ['B','KB','MB','GB','TB']; let i = 0, s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function truncatedName(name: string, maxLen = 12): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen) + '…';
}

const GridItem = React.memo(({ item, iconSize, selected, onSelect, onDoubleClick, onContextMenu, renamingPath, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, renameRef, onDragStart, onDragOver, onDragLeave, onDrop, isDropTarget }: {
  item: FileItem; iconSize: number; selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  renameRef: React.RefObject<HTMLInputElement>;
  onDragStart?: (e: React.DragEvent, item: FileItem) => void;
  onDragOver?: (e: React.DragEvent, item: FileItem) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent, item: FileItem) => void;
  isDropTarget?: boolean;
}) => {
  const [revealed, setRevealed] = useState(false);
  const displayName = revealed ? item.name : truncatedName(item.name);
  const needsTrunc = item.name.length > 12;
  return (
    <div data-path={item.path} onClick={onSelect} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      className={`file-item-grid ${selected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''}`}
      draggable={!renamingPath}
      onDragStart={e => onDragStart?.(e, item)}
      onDragOver={e => onDragOver?.(e, item)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop?.(e, item)}>
      <SystemIcon path={item.path} isDir={item.isDirectory} name={item.name} size={iconSize} iconPath={item.icon} />
      {renamingPath === item.path ? (
        <input ref={renameRef} value={renameValue} onChange={e => onRenameChange(e.target.value)}
          onBlur={onRenameSubmit}
          onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel(); }}
          onClick={e => e.stopPropagation()} autoFocus key="rename-input"
          style={{
            width: '100%', padding: '3px 6px', border: '1px solid var(--border-focus)',
            borderRadius: 'var(--radius-sm)', outline: 'none', background: 'var(--bg-primary)',
            color: 'var(--text-primary)', fontSize: iconSize >= 64 ? 12 : 11, marginTop: 4,
            boxShadow: '0 0 0 3px rgba(26,115,232,0.12)',
          }} />
      ) : (
        <span title={needsTrunc ? item.name : undefined}
          onClick={needsTrunc ? (e => { e.stopPropagation(); setRevealed(p => !p); }) : undefined}
          style={{ fontSize: iconSize >= 64 ? 12 : 11, textAlign: 'center', maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', lineHeight: '1.35',
            cursor: needsTrunc ? 'pointer' : undefined }}>
          {displayName}
        </span>
      )}
    </div>
  );
}, (prev, next) => prev.item.path === next.item.path && prev.selected === next.selected && prev.renamingPath === next.renamingPath && prev.iconSize === next.iconSize && prev.renameValue === next.renameValue);

const RowItem = React.memo(({ item, selected, onSelect, onDoubleClick, onContextMenu, renamingPath, renameValue, onRenameChange, onRenameSubmit, onRenameCancel, renameRef, style, onDragStart, onDragOver, onDragLeave, onDrop, isDropTarget, details }: {
  item: FileItem; selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  renameRef: React.RefObject<HTMLInputElement>;
  style?: React.CSSProperties;
  onDragStart?: (e: React.DragEvent, item: FileItem) => void;
  onDragOver?: (e: React.DragEvent, item: FileItem) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent, item: FileItem) => void;
  isDropTarget?: boolean;
  details?: boolean;
}) => {
  const [revealed, setRevealed] = useState(false);
  const displayName = revealed ? item.name : truncatedName(item.name);
  const needsTrunc = item.name.length > 12;
  return (
    <div data-path={item.path} onClick={onSelect} onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
      className={`file-item-row ${details ? 'details-row' : ''} ${selected ? 'selected' : ''} ${isDropTarget ? 'drop-target' : ''}`}
      draggable={!renamingPath}
      onDragStart={e => onDragStart?.(e, item)}
      onDragOver={e => onDragOver?.(e, item)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop?.(e, item)}
      style={style}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: details ? undefined : 1 }}>
        <SystemIcon path={item.path} isDir={item.isDirectory} name={item.name} size={18} iconPath={item.icon} />
        {renamingPath === item.path ? (
          <input ref={renameRef} value={renameValue} onChange={e => onRenameChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={e => { if (e.key === 'Enter') onRenameSubmit(); if (e.key === 'Escape') onRenameCancel(); }}
            onClick={e => e.stopPropagation()} autoFocus key="rename-input"
            style={{
              flex: 1, width: '100%', padding: '3px 10px', border: '1px solid var(--border-focus)',
              borderRadius: 'var(--radius-sm)', outline: 'none', background: 'var(--bg-primary)',
              color: 'var(--text-primary)', fontSize: 12.5,
              boxShadow: '0 0 0 3px rgba(26,115,232,0.12)',
            }} />
        ) : (
          <span title={needsTrunc ? item.name : undefined}
            onClick={needsTrunc ? (e => { e.stopPropagation(); setRevealed(p => !p); }) : undefined}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: details ? 1 : undefined, fontSize: 12.5,
              cursor: needsTrunc ? 'pointer' : undefined }}>
            {displayName}
          </span>
        )}
      </div>
      {details && (
        <>
          <span title={formatDate(item.modified)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--text-secondary)', padding: '0 8px' }}>
            {formatDate(item.modified)}
          </span>
          <span title={item.isDirectory ? undefined : formatSize(item.size)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--text-secondary)', padding: '0 8px' }}>
            {item.isDirectory ? '—' : formatSize(item.size)}
          </span>
          <span title={item.permissions} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5, color: 'var(--text-tertiary)', padding: '0 8px' }}>
            {item.permissions || '—'}
          </span>
        </>
      )}
    </div>
  );
}, (prev, next) => prev.item.path === next.item.path && prev.selected === next.selected && prev.renamingPath === next.renamingPath && prev.renameValue === next.renameValue && prev.details === next.details);

export const FileView = memo(function FileView({ files, loading, viewMode, selectedFiles, onSelect, onSelectAll, onClearSelection, onOpen, onRename, onContextMenu, isSearching, animKey, pendingRename, onPendingRenameHandled, onDragStart, onDragOver, onDragOverItem, onDragLeaveItem, onDropOnItem, onDropOnBg, onDragEnd, dropTarget }: Props) {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevAnimKeyRef = useRef(animKey);
  const [shouldAnimate, setShouldAnimate] = useState(true);
  const flipFirstRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const flipAnimatingRef = useRef(false);
  const prevViewModeRef = useRef(viewMode);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipRafRef = useRef(0);

  // ── Rubber band selection ──────────────────────────────────────────────────
  const selRectRef = useRef<HTMLDivElement>(null);
  const selDragRef = useRef<{ startX: number; startY: number; el: HTMLElement | null } | null>(null);
  const wasDragRef = useRef(false);
  const lastClickedRef = useRef(-1);

  useEffect(() => {
    if (animKey !== prevAnimKeyRef.current) {
      prevAnimKeyRef.current = animKey;
      setShouldAnimate(true);
      const t = setTimeout(() => setShouldAnimate(false), 400);
      return () => clearTimeout(t);
    }
  }, [animKey]);

  const handleRenameSubmit = useCallback(() => {
    if (renamingPath && renameValue.trim()) onRename(renamingPath, renameValue.trim());
    setRenamingPath(null);
  }, [renamingPath, renameValue, onRename]);

  const startRename = useCallback((item: FileItem) => {
    setRenamingPath(item.path);
    setRenameValue(item.name);
  }, []);

  useEffect(() => {
    if (pendingRename) {
      const item = files.find(f => f.path === pendingRename);
      if (item) startRename(item);
      onPendingRenameHandled?.();
    }
  }, [pendingRename, files, startRename, onPendingRenameHandled]);

  useEffect(() => {
    if (renamingPath && renameRef.current) {
      renameRef.current.focus();
      const dotIdx = renameValue.lastIndexOf('.');
      renameRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : renameValue.length);
    }
  }, [renamingPath]);

  const handleDoubleClick = useCallback((item: FileItem) => {
    if (item.isDirectory) onOpen(item.path, true);
    else window.api.openItem(item.path);
  }, [onOpen]);

  // ── Item selection (click / Ctrl+click / Shift+click) ───────────────────────
  const handleItemSelect = useCallback((e: React.MouseEvent, item: FileItem, index: number) => {
    e.stopPropagation();
    if (e.shiftKey && lastClickedRef.current >= 0) {
      const from = Math.min(lastClickedRef.current, index);
      const to = Math.max(lastClickedRef.current, index);
      onClearSelection();
      for (let i = from; i <= to; i++) {
        if (i >= 0 && i < files.length) onSelect(files[i].path, true);
      }
    } else {
      onSelect(item.path, e.ctrlKey || e.metaKey);
    }
    lastClickedRef.current = index;
  }, [files, onSelect, onClearSelection]);

  const handleBgClick = (e: React.MouseEvent) => {
    if (wasDragRef.current) { wasDragRef.current = false; return; }
    const t = e.target as HTMLElement;
    if (e.target === e.currentTarget || t.dataset.bg === 'true' || t.closest('[data-bg="true"]')) onClearSelection();
  };

  const handleBgContextMenu = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (e.target === e.currentTarget || t.dataset.bg === 'true' || t.closest('[data-bg="true"]')) onContextMenu(e, null);
  };

  // ── Rubber band mousedown handler ───────────────────────────────────────────
  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('.file-item-grid, .file-item-row, .details-header, .breadcrumb, input, button, textarea')) return;

    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();

    selDragRef.current = { startX: e.clientX, startY: e.clientY, el: container };

    const handleMove = (me: MouseEvent) => {
      const drag = selDragRef.current;
      if (!drag) return;
      const dx = me.clientX - drag.startX;
      const dy = me.clientY - drag.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) wasDragRef.current = true;
      const el = selRectRef.current;
      if (!el) return;
      el.style.display = 'block';
      el.style.left = `${Math.min(drag.startX, me.clientX) - cRect.left}px`;
      el.style.top = `${Math.min(drag.startY, me.clientY) - cRect.top}px`;
      el.style.width = `${Math.abs(dx)}px`;
      el.style.height = `${Math.abs(dy)}px`;
    };

    const handleUp = (ue: MouseEvent) => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);

      const el = selRectRef.current;
      if (el) el.style.display = 'none';

      const drag = selDragRef.current;
      selDragRef.current = null;

      if (!drag || !wasDragRef.current) return;

      const left = Math.min(drag.startX, ue.clientX);
      const top = Math.min(drag.startY, ue.clientY);
      const right = Math.max(drag.startX, ue.clientX);
      const bottom = Math.max(drag.startY, ue.clientY);

      const itemEls = container.querySelectorAll<HTMLElement>('.file-item-grid, .file-item-row');
      const toSelect: string[] = [];
      itemEls.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
          const p = el.dataset.path;
          if (p) toSelect.push(p);
        }
      });
      if (toSelect.length > 0) {
        onClearSelection();
        toSelect.forEach(p => onSelect(p, true));
      }
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [onClearSelection, onSelect]);

  const itemDragStart = useCallback((e: React.DragEvent, item: FileItem) => onDragStart?.(e, item), [onDragStart]);
  const itemDragOver = useCallback((e: React.DragEvent, item: FileItem) => onDragOverItem?.(e, item), [onDragOverItem]);
  const itemDragLeave = useCallback(() => onDragLeaveItem?.(), [onDragLeaveItem]);
  const itemDrop = useCallback((e: React.DragEvent, item: FileItem) => onDropOnItem?.(e, item), [onDropOnItem]);

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onDragOver?.(e);
  }, [onDragOver]);

  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onDropOnBg?.(e);
  }, [onDropOnBg]);

  const isVerticalView = viewMode === 'list' || viewMode === 'details';
  const rowHeight = useMemo(() => {
    switch (viewMode) {
      case 'list': return 44;
      case 'details': return 44;
      default: return 0;
    }
  }, [viewMode]);

  const iconSize = viewMode === 'grid-lg' ? 64 : viewMode === 'grid-sm' ? 32 : 48;

  const vs = useVirtualScroll({
    itemCount: isVerticalView ? files.length : 0,
    itemHeight: rowHeight,
    overscan: 8,
  });
  const gridVs = useGridVirtualScroll({
    itemCount: isVerticalView ? 0 : files.length,
    iconSize,
    overscan: 4,
  });
  const attachScrollRef = useCallback((el: HTMLDivElement | null) => {
    (vs.containerRef as { current: HTMLDivElement | null }).current = el;
    (gridVs.containerRef as { current: HTMLDivElement | null }).current = el;
    (containerRef as { current: HTMLDivElement | null }).current = el;
  }, [vs.containerRef, gridVs.containerRef]);

  // ── FLIP: animate items gliding to their new layout on view-mode switch ────
  const capturePositions = useCallback((out: Map<string, { x: number; y: number }>) => {
    out.clear();
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    container.querySelectorAll<HTMLElement>('[data-path]').forEach(el => {
      const p = el.dataset.path;
      if (!p) return;
      const r = el.getBoundingClientRect();
      out.set(p, { x: r.left - cRect.left, y: r.top - cRect.top });
    });
  }, []);

  // On view-mode change: FLIP visible items from their old to their new position.
  // Declared BEFORE the snapshot effect so it consumes the "First" positions first.
  useLayoutEffect(() => {
    if (prevViewModeRef.current === viewMode) return;
    prevViewModeRef.current = viewMode;

    const container = containerRef.current;
    if (!container) return;

    const first = flipFirstRef.current;
    const last = new Map<string, { x: number; y: number }>();
    capturePositions(last);

    const items: { el: HTMLElement; dx: number; dy: number }[] = [];
    first.forEach((a, path) => {
      const b = last.get(path);
      if (!b) return;
      const el = container.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`);
      if (!el) return;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      items.push({ el, dx, dy });
    });

    if (items.length === 0) {
      capturePositions(flipFirstRef.current);
      return;
    }

    flipAnimatingRef.current = true;
    for (const { el, dx, dy } of items) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.willChange = 'transform';
    }

    flipRafRef.current = requestAnimationFrame(() => {
      for (const { el } of items) void el.offsetWidth;
      for (const { el } of items) {
        el.style.transition = 'transform 0.35s var(--ease-spring)';
        el.style.transform = 'translate(0, 0)';
      }
      flipTimerRef.current = setTimeout(() => {
        for (const { el } of items) {
          el.style.transition = '';
          el.style.transform = '';
          el.style.willChange = '';
        }
        flipAnimatingRef.current = false;
        capturePositions(flipFirstRef.current);
      }, 400);
    });
  }, [viewMode, capturePositions]);

  // Keep a steady-state snapshot of visible item positions (the FLIP "First").
  useLayoutEffect(() => {
    if (flipAnimatingRef.current) return;
    capturePositions(flipFirstRef.current);
  }, [viewMode, files, vs.offsetY, gridVs.offsetY, gridVs.colsPerRow, capturePositions]);

  useEffect(() => () => {
    if (flipRafRef.current) cancelAnimationFrame(flipRafRef.current);
    if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
  }, []);

  const visibleFiles = useMemo(
    () => isVerticalView ? files.slice(vs.visibleRange.start, vs.visibleRange.end) : files,
    [files, vs.visibleRange.start, vs.visibleRange.end, isVerticalView]
  );

  const visibleGridItems = useMemo(
    () => files.slice(gridVs.visibleRange.start, gridVs.visibleRange.end),
    [files, gridVs.visibleRange.start, gridVs.visibleRange.end]
  );

  // ── ArkUI Prefetcher port: decode thumbnails just past the viewport edge ───
  // Low-priority, LIFO (nearest edge wins), capped so fast scroll cancels stale work.
  useEffect(() => {
    const ahead = isVerticalView ? vs.visibleRange.end : gridVs.visibleRange.end;
    const behind = isVerticalView ? vs.visibleRange.start : gridVs.visibleRange.start;
    const STEP = 10;
    const hi = Math.min(ahead + STEP, files.length);
    const lo = Math.max(behind - STEP, 0);
    for (let i = ahead; i < hi; i++) {
      const f = files[i];
      if (f && !f.isDirectory && isImage(f.name)) prefetchThumbnail(f.path);
    }
    for (let i = behind - 1; i >= lo; i--) {
      const f = files[i];
      if (f && !f.isDirectory && isImage(f.name)) prefetchThumbnail(f.path);
    }
  }, [files, isVerticalView, vs.visibleRange.start, vs.visibleRange.end, gridVs.visibleRange.start, gridVs.visibleRange.end]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
        <div style={{
          width: 32, height: 32, border: '3px solid var(--border-primary)',
          borderTopColor: 'var(--accent)', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span style={{ color: 'var(--text-tertiary)', fontSize: 12.5, fontWeight: 400 }}>Loading...</span>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div data-bg="true" onClick={handleBgClick} onContextMenu={handleBgContextMenu} style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 12, color: 'var(--text-tertiary)',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 'var(--radius-xl)',
          background: 'var(--accent-gradient-soft)',
          border: '1px solid var(--border-primary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 32, boxShadow: 'var(--shadow-sm)',
          color: 'var(--accent)',
        }}>
          {isSearching ? (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          ) : (
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          )}
        </div>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{isSearching ? 'No results found' : 'This folder is empty'}</span>
        {!isSearching && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>Drop files here or create a new folder</span>}
      </div>
    );
  }

  const animClass = shouldAnimate ? 'stagger-children anim-fade-in' : '';

  const renderDetailsView = () => (
    <div style={{ width: '100%', position: 'relative' }}>
      <div className="details-header">
        <span>Name</span><span>Date Modified</span><span>Size</span><span>Perms</span>
      </div>
      <div style={{ height: vs.totalHeight, position: 'relative' }}>
        <div className={`fvw ${animClass}`} style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          transform: `translateY(${vs.offsetY}px)`,
        }}>
          {visibleFiles.map((item, i) => {
            const index = vs.visibleRange.start + i;
            return (
              <RowItem key={item.path} item={item} selected={selectedFiles.has(item.path)}
                onSelect={e => handleItemSelect(e, item, index)}
                onDoubleClick={() => handleDoubleClick(item)}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onSelect(item.path, false); onContextMenu(e, item); }}
                renamingPath={renamingPath} renameValue={renameValue}
                onRenameChange={setRenameValue} onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingPath(null)} renameRef={renameRef}
                details
                style={{ gridTemplateColumns: '1fr 140px 100px 80px', display: 'grid', position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight, alignItems: 'center', padding: '0 16px' }}
                onDragStart={itemDragStart} onDragOver={itemDragOver} onDragLeave={itemDragLeave} onDrop={itemDrop}
                isDropTarget={dropTarget === item.path && item.isDirectory}
              />
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderGridView = () => {
    const visibleItems = visibleGridItems;
    return (
      <div style={{ height: gridVs.totalHeight, position: 'relative' }}>
        <div className={`file-grid fvw ${animClass}`} style={{
          position: 'absolute', top: 0, left: 12, right: 12,
          transform: `translateY(${gridVs.offsetY}px)`,
          display: 'grid',
          gridTemplateColumns: `repeat(${gridVs.colsPerRow}, 1fr)`,
          gap: 4, contain: 'layout style paint',
        }}>
          {visibleItems.map((item, i) => (
            <GridItem key={item.path} item={item} iconSize={iconSize}
              selected={selectedFiles.has(item.path)}
              onSelect={e => handleItemSelect(e, item, gridVs.visibleRange.start + i)}
              onDoubleClick={() => handleDoubleClick(item)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onSelect(item.path, false); onContextMenu(e, item); }}
              renamingPath={renamingPath} renameValue={renameValue}
              onRenameChange={setRenameValue} onRenameSubmit={handleRenameSubmit}
              onRenameCancel={() => setRenamingPath(null)} renameRef={renameRef}
              onDragStart={itemDragStart} onDragOver={itemDragOver} onDragLeave={itemDragLeave} onDrop={itemDrop}
              isDropTarget={dropTarget === item.path && item.isDirectory}
            />
          ))}
        </div>
      </div>
    );
  };

  const renderListView = () => (
    <div style={{ height: vs.totalHeight, position: 'relative', padding: '6px 10px' }}>
      <div className={`file-list fvw ${animClass}`} style={{
        position: 'absolute', top: 0, left: 10, right: 10,
        transform: `translateY(${vs.offsetY}px)`,
      }}>
        {visibleFiles.map((item, i) => {
          const index = vs.visibleRange.start + i;
          return (
            <RowItem key={item.path} item={item} selected={selectedFiles.has(item.path)}
              style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}
              onSelect={e => handleItemSelect(e, item, index)}
              onDoubleClick={() => handleDoubleClick(item)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onSelect(item.path, false); onContextMenu(e, item); }}
              renamingPath={renamingPath} renameValue={renameValue}
              onRenameChange={setRenameValue} onRenameSubmit={handleRenameSubmit}
              onRenameCancel={() => setRenamingPath(null)} renameRef={renameRef}
              onDragStart={itemDragStart} onDragOver={itemDragOver} onDragLeave={itemDragLeave} onDrop={itemDrop}
              isDropTarget={dropTarget === item.path && item.isDirectory}
            />
          );
        })}
      </div>
    </div>
  );

  return (
    <div ref={attachScrollRef} data-bg="true" onClick={handleBgClick} onContextMenu={handleBgContextMenu}
      onMouseDown={handleContainerMouseDown}
      onDragOver={handleContainerDragOver} onDrop={handleContainerDrop} onDragEnd={onDragEnd}
      onKeyDown={e => {
        if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSelectAll(); }
        if (e.key === 'F2' && selectedFiles.size === 1) {
          const item = files.find(f => f.path === Array.from(selectedFiles)[0]);
          if (item) startRename(item);
        }
      }}
      tabIndex={0} className="file-view-scroll">
      {viewMode === 'details' ? renderDetailsView() :
       viewMode === 'list' ? renderListView() :
       renderGridView()}
      <div ref={selRectRef} className="selection-rect" style={{
        position: 'absolute', left: 0, top: 0, width: 0, height: 0,
        display: 'none', pointerEvents: 'none', zIndex: 50,
      }} />
    </div>
  );
});
