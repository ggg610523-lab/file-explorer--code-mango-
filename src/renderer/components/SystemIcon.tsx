import React, { useState, useEffect } from 'react';
import { getCachedThumbnail, loadThumbnail } from '../thumbnailManager';

const iconCache = new Map<string, string>();
const ICON_CACHE_MAX = 2000;
function cacheIcon(path: string, icon: string) {
  iconCache.delete(path);
  iconCache.set(path, icon);
  if (iconCache.size > ICON_CACHE_MAX) {
    const oldest = iconCache.keys().next().value;
    if (oldest !== undefined) iconCache.delete(oldest);
  }
}

// Coalesce per-icon IPC into small `resolveIcons` batches so a directory with
// many unknown file types doesn't fire one IPC (and one `file` probe) per item.
const pendingResolve = new Map<string, { path: string; isDir: boolean; name: string }>();
const iconCallbacks = new Map<string, ((icon: string | null) => void)[]>();
let resolveTimer: number | null = null;
const RESOLVE_BATCH = 24;

function flushResolveQueue() {
  resolveTimer = null;
  const items = Array.from(pendingResolve.values());
  pendingResolve.clear();
  if (items.length === 0) return;
  const batch = items.slice(0, RESOLVE_BATCH);
  if (items.length > RESOLVE_BATCH) scheduleResolveFlush();
  window.api.resolveIcons(batch).then(map => {
    for (const item of batch) {
      const icon = map[item.path] || null;
      const cbs = iconCallbacks.get(item.path) || [];
      iconCallbacks.delete(item.path);
      if (icon) cacheIcon(item.path, icon);
      for (const cb of cbs) cb(icon);
    }
  });
}

function scheduleResolveFlush() {
  if (resolveTimer === null) resolveTimer = window.setTimeout(flushResolveQueue, 30);
}

function requestIcon(path: string, isDir: boolean, name: string, cb: (icon: string | null) => void) {
  const cached = iconCache.get(path);
  if (cached) { cb(cached); return; }
  const existing = iconCallbacks.get(path);
  if (existing) { existing.push(cb); return; }
  iconCallbacks.set(path, [cb]);
  pendingResolve.set(path, { path, isDir, name });
  scheduleResolveFlush();
}

const imageExtensions = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif',
]);

interface Props {
  path: string | null;
  isDir: boolean;
  name?: string;
  size?: number;
  iconPath?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return imageExtensions.has(ext);
}

export function SystemIcon({ path: filePath, isDir, name, size = 20, iconPath, className, style }: Props) {
  const [src, setSrc] = useState<string | null>(() => {
    if (iconPath) return iconPath;
    if (filePath && !isDir && name && isImage(name)) return getCachedThumbnail(filePath);
    if (filePath && iconCache.has(filePath)) return iconCache.get(filePath)!;
    return null;
  });
  const [isThumbnail, setIsThumbnail] = useState(() => !!(filePath && !isDir && name && isImage(name)));

  useEffect(() => {
    setIsThumbnail(!!(filePath && !isDir && name && isImage(name)));

    if (iconPath) {
      setSrc(iconPath);
      if (filePath) cacheIcon(filePath, iconPath);
      return;
    }
    if (!filePath) { setSrc(null); return; }

    if (!isDir && name && isImage(name)) {
      const cached = getCachedThumbnail(filePath);
      if (cached) { setSrc(cached); return; }
      let cancelled = false;
      loadThumbnail(filePath).then(url => {
        if (!cancelled) setSrc(url);
      }).catch(() => {
        if (!cancelled) {
          requestIcon(filePath, isDir, name || '', icon => {
            if (icon) setSrc(icon);
            else setSrc(null);
          });
        }
      });
      return () => { cancelled = true; };
    }

    if (iconCache.has(filePath)) {
      setSrc(iconCache.get(filePath)!);
      return;
    }

    let cancelled = false;
    requestIcon(filePath, isDir, name || '', icon => {
      if (!cancelled && icon) setSrc(icon);
    });
    return () => { cancelled = true; };
  }, [filePath, isDir, name, iconPath]);

  if (!src) {
    if (isThumbnail) {
      return (
        <div className="thumb-placeholder" style={{ width: size, height: size, borderRadius: size * 0.15, flexShrink: 0, ...style }} />
      );
    }
    return (
      <span style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.8, flexShrink: 0, ...style }} className={className}>
        {isDir ? '📁' : '📄'}
      </span>
    );
  }

  return (
    <img
      src={src}
      width={size}
      height={size}
      className={`icon-img ${className || ''}`}
      style={{ ...style, width: size, height: size, objectFit: isThumbnail ? 'cover' : undefined }}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (isThumbnail && filePath) {
          setIsThumbnail(false);
          requestIcon(filePath, isDir, name || '', icon => {
            if (icon) setSrc(icon);
            else setSrc(null);
          });
        } else {
          setSrc(null);
        }
      }}
    />
  );
}
