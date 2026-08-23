import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileItem } from '../types';

interface Props {
  file: FileItem;
  onClose: () => void;
  onOpenWith: (path: string) => void;
  onDelete: () => void;
  onOpen: () => void;
  onExtractHere: (path: string) => void;
  onExtractToDesktop?: (archiveName: string, archivePath: string) => void;
}

const imageExtensions = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif',
]);

const videoExtensions = new Set(['mp4', 'webm', 'avi', 'mov', 'mkv', 'wmv', 'flv']);
const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a']);

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
}

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function getFileType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const typeMap: Record<string, string> = {
    jpg: 'JPEG Image', jpeg: 'JPEG Image', png: 'PNG Image', gif: 'GIF Image',
    bmp: 'BMP Image', webp: 'WebP Image', svg: 'SVG Image', ico: 'Icon',
    tiff: 'TIFF Image', tif: 'TIFF Image',
    pdf: 'PDF Document',
    mp4: 'MP4 Video', webm: 'WebM Video', avi: 'AVI Video', mov: 'MOV Video',
    mkv: 'MKV Video', wmv: 'WMV Video', flv: 'FLV Video',
    mp3: 'MP3 Audio', wav: 'WAV Audio', ogg: 'OGG Audio', flac: 'FLAC Audio',
    aac: 'AAC Audio', wma: 'WMA Audio', m4a: 'M4A Audio',
    zip: 'ZIP Archive', tar: 'TAR Archive', gz: 'GZip Archive',
    bz2: 'BZip2 Archive', xz: 'XZ Archive', rar: 'RAR Archive',
    '7z': '7-Zip Archive',
    txt: 'Text Document', md: 'Markdown File', json: 'JSON File',
    xml: 'XML File', yaml: 'YAML File', yml: 'YAML File',
    js: 'JavaScript File', ts: 'TypeScript File', py: 'Python File',
    java: 'Java File', c: 'C Source', cpp: 'C++ Source', h: 'C Header',
    html: 'HTML File', css: 'CSS File', scss: 'SCSS File',
    sh: 'Shell Script', bat: 'Batch File', exe: 'Executable',
    dmg: 'Disk Image', iso: 'Disk Image',
    doc: 'Word Document', docx: 'Word Document',
    xls: 'Excel Spreadsheet', xlsx: 'Excel Spreadsheet',
    ppt: 'PowerPoint', pptx: 'PowerPoint',
    csv: 'CSV File', rtf: 'Rich Text',
  };
  return typeMap[ext] || `${ext.toUpperCase()} File`;
}

const archiveExtensions = new Set(['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar']);

const PreviewPanel: React.FC<Props> = ({ file, onClose, onOpenWith, onDelete, onOpen, onExtractHere, onExtractToDesktop }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [archiveEntries, setArchiveEntries] = useState<{ name: string; size: number; isDir: boolean }[] | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const copyPath = useCallback(() => {
    navigator.clipboard.writeText(file.path);
  }, [file.path]);

  const isImage = imageExtensions.has(file.name.split('.').pop()?.toLowerCase() || '');
  const isVideo = videoExtensions.has(file.name.split('.').pop()?.toLowerCase() || '');
  const isAudio = audioExtensions.has(file.name.split('.').pop()?.toLowerCase() || '');
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  const isArchive = archiveExtensions.has(file.name.split('.').pop()?.toLowerCase() || '');

  const localUrl = `thumbnails://${file.path}`;

  const handleBodyDoubleClick = useCallback(() => {
    if (file.isDirectory) onOpen();
  }, [file.isDirectory, onOpen]);

  useEffect(() => {
    if (!isArchive || file.isDirectory) { setArchiveEntries(null); setArchiveError(null); return; }
    let cancelled = false;
    setArchiveLoading(true);
    setArchiveError(null);
    window.api.listArchive(file.path).then(res => {
      if (cancelled) return;
      setArchiveLoading(false);
      if (res.success) setArchiveEntries(res.entries);
      else setArchiveError(res.error || 'Failed to list archive');
    });
    return () => { cancelled = true; };
  }, [file.path, isArchive, file.isDirectory]);

  const handleExtract = useCallback(async () => {
    if (onExtractToDesktop) {
      onExtractToDesktop(file.name, file.path);
    } else {
      const dir = await window.api.getHomeDir();
      const base = file.name.replace(/\.(zip|tar|gz|bz2|xz|7z|rar)$/i, '');
      const dest = `${dir}/Desktop/${base}`;
      const res = await window.api.extractArchive(file.path, dest);
      if (res.success) onClose();
      else alert(`Extraction failed: ${res.error}`);
    }
  }, [file.path, file.name, onClose, onExtractToDesktop]);

  return (
    <>
      <div className="preview-overlay" onClick={onClose} />
      <div ref={panelRef} className="preview-panel">
        <div className="preview-header">
          <span className="preview-title">Preview</span>
          <button className="preview-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="preview-body" onDoubleClick={handleBodyDoubleClick}>
          {file.isDirectory ? (
            <div className="preview-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#e2a63b">
                <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/>
              </svg>
              <span className="preview-placeholder-text">Double-click to open folder</span>
            </div>
          ) : isImage ? (
            <div className="preview-media-container">
              <img src={localUrl} alt={file.name} className="preview-image" />
            </div>
          ) : isVideo ? (
            <div className="preview-media-container">
              <video src={localUrl} controls className="preview-video" />
            </div>
          ) : isAudio ? (
            <div className="preview-media-container">
              <div className="preview-audio-wrapper">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="#7c4dff">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <audio src={localUrl} controls className="preview-audio" />
              </div>
            </div>
          ) : isPdf ? (
            <div className="preview-media-container">
              <embed src={localUrl} type="application/pdf" className="preview-pdf" />
            </div>
          ) : isArchive && archiveLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 12 }}>
              <div style={{ width: 16, height: 16, border: '2px solid var(--border-primary)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              Listing archive...
            </div>
          ) : isArchive && archiveError ? (
            <div className="preview-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#f44336">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span className="preview-placeholder-text" style={{ color: 'var(--text-tertiary)', maxWidth: 240, textAlign: 'center', fontSize: 11 }}>{archiveError}</span>
            </div>
          ) : isArchive && archiveEntries ? (
            <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: '8px 0' }}>
              <div style={{ padding: '4px 14px 8px', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                {archiveEntries.length} {archiveEntries.length === 1 ? 'entry' : 'entries'}
              </div>
              {archiveEntries.slice(0, 200).map((entry, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 14px', fontSize: 11.5, color: entry.isDir ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                  {entry.isDir ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#e2a63b" style={{ flexShrink: 0 }}><path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z"/></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="#90caf9" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6" fill="none" stroke="#fff" strokeWidth="2"/></svg>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                  {!entry.isDir && entry.size > 0 && <span style={{ marginLeft: 'auto', flexShrink: 0, color: 'var(--text-tertiary)', fontSize: 10 }}>{formatSize(entry.size)}</span>}
                </div>
              ))}
              {archiveEntries.length > 200 && (
                <div style={{ padding: '6px 14px', fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>+ {archiveEntries.length - 200} more</div>
              )}
            </div>
          ) : (
            <div className="preview-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="#90caf9">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>
                <path d="M14 2v6h6" fill="none" stroke="#fff" strokeWidth="2"/>
              </svg>
              <span className="preview-placeholder-text">{getFileType(file.name)}</span>
            </div>
          )}
        </div>

        <div className="preview-actions">
          <button className="preview-action-btn primary" onClick={onOpen}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            Open
          </button>
          {!file.isDirectory && (
            <button className="preview-action-btn" onClick={() => onOpenWith(file.path)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Open With
            </button>
          )}
          {isArchive && archiveEntries && !archiveLoading && (
            <>
              <button className="preview-action-btn" onClick={() => onExtractHere(file.path)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Extract Here
              </button>
              <button className="preview-action-btn" onClick={handleExtract}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><polyline points="10 3 14 7 10 11"/><line x1="14" y1="7" x2="3" y2="7"/>
                </svg>
                Extract to Desktop
              </button>
            </>
          )}
          <button className="preview-action-btn" onClick={copyPath}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="9" width="13" height="13" rx="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy Path
          </button>
          <button className="preview-action-btn danger" onClick={onDelete}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
          </button>
        </div>

        <div className="preview-metadata">
          <div className="preview-meta-row">
            <span className="preview-meta-label">Name</span>
            <span className="preview-meta-value">{file.name}</span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Type</span>
            <span className="preview-meta-value">{file.isDirectory ? 'Folder' : getFileType(file.name)}</span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Size</span>
            <span className="preview-meta-value">{file.isDirectory ? '—' : formatSize(file.size)}</span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Modified</span>
            <span className="preview-meta-value">{formatDate(file.modified)}</span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Created</span>
            <span className="preview-meta-value">{formatDate(file.created)}</span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Permissions</span>
            <span className="preview-meta-value">{file.permissions || '—'}</span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Path</span>
            <span className="preview-meta-value path">{file.path}</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default PreviewPanel;
