import React, { useState, useEffect, useRef } from 'react';

interface ProgressState {
  visible: boolean;
  operation: string;
  totalFiles: number;
  totalBytes: number;
  filesDone: number;
  bytesDone: number;
  currentFile: string;
  sources: string[];
  complete: boolean;
}

function fmtBytes(b: number): string {
  if (!b) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0, s = b;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtSpeed(bytesPerSec: number): string {
  if (!bytesPerSec) return '';
  return `${fmtBytes(bytesPerSec)}/s`;
}

function fmtETA(bytesRemaining: number, bytesPerSec: number): string {
  if (!bytesPerSec || !bytesRemaining) return '';
  const secs = Math.ceil(bytesRemaining / bytesPerSec);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function CopyProgress() {
  const [state, setState] = useState<ProgressState>({
    visible: false, operation: '', totalFiles: 0, totalBytes: 0,
    filesDone: 0, bytesDone: 0, currentFile: '', sources: [], complete: false,
  });
  const startTimeRef = useRef(Date.now());
  const autoHideTimer = useRef<ReturnType<typeof setTimeout>>();
  const prevBytesRef = useRef(0);
  const [speed, setSpeed] = useState(0);

  useEffect(() => {
    const removeListener = window.api.onCopyProgress((data: any) => {
      if (data.type === 'start') {
        startTimeRef.current = Date.now();
        prevBytesRef.current = 0;
        if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
        setState({
          visible: true, operation: data.operation, totalFiles: data.totalFiles,
          totalBytes: data.totalBytes, filesDone: 0, bytesDone: 0,
          currentFile: '', sources: data.sources || [], complete: false,
        });
      } else if (data.type === 'progress') {
        setState(prev => ({
          ...prev,
          filesDone: data.filesDone,
          bytesDone: data.bytesDone,
          currentFile: data.currentFile,
        }));
        // Calculate speed (smoothed)
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        if (elapsed > 0.3) {
          setSpeed(data.bytesDone / elapsed);
        }
      } else if (data.type === 'complete') {
        setState(prev => ({ ...prev, complete: true }));
        autoHideTimer.current = setTimeout(() => {
          setState(prev => ({ ...prev, visible: false }));
        }, 1200);
      }
    });
    return () => {
      removeListener();
      if (autoHideTimer.current) clearTimeout(autoHideTimer.current);
    };
  }, []);

  if (!state.visible) return null;

  const pct = state.totalFiles > 0 ? Math.min((state.filesDone / state.totalFiles) * 100, 100) : 0;
  const pctBytes = state.totalBytes > 0 ? Math.min((state.bytesDone / state.totalBytes) * 100, 100) : 0;
  const remaining = Math.max(state.totalBytes - state.bytesDone, 0);
  const label = state.operation === 'move' ? 'Moving' : 'Copying';

  return (
    <div className="copy-progress-dialog anim-slide-up" style={{
      position: 'fixed', bottom: 48, right: 20, zIndex: 9000,
      width: 360, background: 'var(--bg-primary)',
      border: '1px solid var(--border-primary)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-context)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px 8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.complete ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1"/>
            </svg>
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {state.complete ? `${label} complete` : `${label} ${state.sources.length === 1 ? state.sources[0] : `${state.totalFiles} items`}`}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>
          {state.complete ? '100%' : `${Math.round(pct)}%`}
        </span>
      </div>

      {/* Progress bar */}
      <div style={{ padding: '0 16px' }}>
        <div style={{
          width: '100%', height: 5, borderRadius: 3,
          background: 'var(--bg-active)', overflow: 'hidden',
        }}>
          <div style={{
            height: '100%', borderRadius: 3,
            background: state.complete ? 'linear-gradient(135deg, #22c55e, #4ade80)' : 'var(--accent-gradient-vivid)',
            width: `${state.complete ? 100 : pctBytes}%`,
            transition: 'width 0.25s var(--ease-out)',
            boxShadow: state.complete ? '0 0 8px rgba(34,197,94,0.3)' : '0 0 8px rgba(59,130,246,0.3)',
          }} />
        </div>
      </div>

      {/* Details */}
      <div style={{
        padding: '8px 16px 12px',
        display: 'flex', flexDirection: 'column', gap: 2,
      }}>
        {!state.complete && state.currentFile && (
          <div style={{
            fontSize: 11.5, color: 'var(--text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {state.currentFile}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {state.filesDone} of {state.totalFiles} files
            {state.totalBytes > 0 && ` · ${fmtBytes(state.bytesDone)} of ${fmtBytes(state.totalBytes)}`}
          </span>
          {!state.complete && speed > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {fmtSpeed(speed)} · {fmtETA(remaining, speed)} left
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
