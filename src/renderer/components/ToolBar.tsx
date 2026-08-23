import React from 'react';
import { ViewMode, SortField, SortOrder } from '../types';

interface Props {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onNewFolder: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onRefresh: () => void;
  onOpenTerminal: () => void;
  onSort: (field: SortField) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  hasSelection: boolean;
  hasClipboard: boolean;
  previewOpen: boolean;
  onTogglePreview: () => void;
  onCompress: () => void;
}

export function ToolBar({
  viewMode, onViewModeChange, onNewFolder, onCut, onCopy, onPaste,
  onDelete, onRefresh, onOpenTerminal, onSort, sortField, sortOrder,
  hasSelection, hasClipboard, previewOpen, onTogglePreview, onCompress,
}: Props) {
  const Ico = ({ d, size = 14 }: { d: string; size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );

  const Btn = ({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) => (
    <button className="tool-btn" onClick={onClick} disabled={disabled} title={label}>
      <span className="icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
      <span>{label}</span>
    </button>
  );

  return (
    <div className="anim-fade-in toolbar-row" style={{
      display: 'flex', alignItems: 'center', height: 'var(--toolbar-h)',
      padding: '0 14px', gap: 2,
      background: 'var(--bg-primary)', borderBottom: '1px solid var(--border-primary)',
    }}>
      <Btn label="New" icon={<Ico d="M12 5v14M5 12h14" />} onClick={onNewFolder} />
      <div className="separator" />
      <Btn label="Cut" icon={<Ico d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15c0 3 3 6 6 6s6-3 6-6" />} onClick={onCut} disabled={!hasSelection} />
      <Btn label="Copy" icon={<Ico d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v4M12 10h4M12 14h2" />} onClick={onCopy} disabled={!hasSelection} />
      <Btn label="Paste" icon={<Ico d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M12 12v6M9 15l3 3 3-3" />} onClick={onPaste} disabled={!hasClipboard} />
      <Btn label="Delete" icon={<Ico d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />} onClick={onDelete} disabled={!hasSelection} />
      <Btn label="Compress" icon={<Ico d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />} onClick={onCompress} disabled={!hasSelection} />
      <div className="separator" />
      <Btn label="Refresh" icon={<Ico d="M1 4v6h6M23 20v-6h-6M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15" />} onClick={onRefresh} />
      <div className="separator" />
      <Btn label="Terminal" icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      } onClick={onOpenTerminal} />
      <Btn label="Preview" icon={
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7"/>
        </svg>
      } onClick={onTogglePreview} />
      <div style={{ flex: 1 }} />
      <div className="pill-group">
        {(['name', 'modified', 'size', 'type'] as SortField[]).map(f => (
          <button key={f} onClick={() => onSort(f)}
            className={sortField === f ? 'pill-active' : ''}
          >{f === 'modified' ? 'Date' : f.charAt(0).toUpperCase() + f.slice(1)}{sortField === f ? (sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        ))}
      </div>
      <div className="separator" />
      <div className="pill-group">
        {([
          { mode: 'grid-lg' as ViewMode, label: 'Large', d: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
          { mode: 'grid-md' as ViewMode, label: 'Medium', d: 'M3 3h4v4H3zM10 3h4v4h-4zM17 3h4v4h-4zM3 10h4v4H3zM10 10h4v4h-4zM17 10h4v4h-4zM3 17h4v4H3zM10 17h4v4h-4zM17 17h4v4h-4z' },
          { mode: 'grid-sm' as ViewMode, label: 'Small', d: 'M3 3h3v3H3zM7 3h3v3H7zM11 3h3v3h-3zM15 3h3v3h-3zM19 3h3v3h-3zM3 7h3v3H3zM7 7h3v3H7zM11 7h3v3h-3zM15 7h3v3h-3zM19 7h3v3h-3zM3 11h3v3H3zM7 11h3v3H7zM11 11h3v3h-3zM15 11h3v3h-3zM19 11h3v3h-3z' },
          { mode: 'details' as ViewMode, label: 'Details', d: 'M3 5h18M3 10h18M3 15h18M3 20h18' },
          { mode: 'list' as ViewMode, label: 'List', d: 'M4 6h16M4 12h16M4 18h16' },
        ]).map(({ mode, label, d }) => (
          <button key={mode} onClick={() => onViewModeChange(mode)} title={label}
            className={viewMode === mode ? 'pill-active' : ''}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}
          >
            <Ico d={d} size={13} />
          </button>
        ))}
      </div>
    </div>
  );
}
