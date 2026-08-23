import React from 'react';
import { FileItem } from '../types';

interface Props {
  files: FileItem[];
  selectedFiles: Set<string>;
  currentPath: string;
  isSearching: boolean;
  searchQuery: string;
}

export function StatusBar({ files, selectedFiles, currentPath, isSearching, searchQuery }: Props) {
  const total = files.length;
  const sel = selectedFiles.size;
  const selSize = files.filter(f => selectedFiles.has(f.path)).reduce((s, f) => s + f.size, 0);
  const fmt = (b: number) => { if (!b) return '0 B'; const u = ['B','KB','MB','GB','TB']; let i = 0, s = b; while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; } return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`; };

  return (
    <div className="status-bar anim-fade-in">
      <span>{isSearching ? `${total} results for "${searchQuery}"` : `${total} items`}</span>
      {sel > 0 && (
        <span style={{ color: 'var(--accent)', animation: 'popIn 0.15s var(--ease-spring)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          {sel} selected ({fmt(selSize)})
        </span>
      )}
      <div style={{ flex: 1 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400, opacity: 0.6 }}>{currentPath}</span>
    </div>
  );
}
