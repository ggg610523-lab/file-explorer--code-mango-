import React, { useState, useEffect } from 'react';
import { DriveInfo } from '../types';
import { SystemIcon } from './SystemIcon';

interface Props {
  onNavigate: (path: string) => void;
  currentPath: string;
  activeView: string;
  onShowApplications: () => void;
  trashInfo: { path: string; count: number } | null;
}

// Uniform icon slot: every sidebar row renders its icon inside the same
// fixed-size box so glyphs optically align across all sections (iOS-style).
const SLOT: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 7,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};

export function NavigationPane({ onNavigate, currentPath, activeView, onShowApplications, trashInfo }: Props) {
  const [pinnedFolders, setPinnedFolders] = useState<{ name: string; path: string; icon: string }[]>([]);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [specialIcons, setSpecialIcons] = useState<Record<string, string | null>>({});
  const [appsIcon, setAppsIcon] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['pinned', 'drives']));
  const [trash, setTrash] = useState<{ path: string; count: number } | null>(trashInfo);

  useEffect(() => {
    window.api.getPinnedFolders().then(setPinnedFolders);
    window.api.getDrives().then(setDrives);
    window.api.getSpecialIcons().then(setSpecialIcons);
    window.api.resolveIcon('applications-other').then(setAppsIcon);
    const unsubDrives = window.api.onDrivesChanged(() => {
      window.api.getDrives().then(setDrives);
    });
    const unsubTrash = window.api.onTrashChanged(() => {
      window.api.getTrashInfo().then(setTrash);
    });
    return () => { unsubDrives(); unsubTrash(); };
  }, []);

  const toggle = (s: string) => setExpanded(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const fmt = (b: number) => {
    if (!b) return '';
    const u = ['B','KB','MB','GB','TB']; let i = 0, s = b;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return `${s.toFixed(1)} ${u[i]}`;
  };
  const isActive = (p: string) => currentPath === p;

  return (
    <div className="sidebar-scroll" style={{
      width: '100%', height: '100%',
      background: 'var(--bg-sidebar)',
      overflowY: 'auto', overflowX: 'hidden', padding: '6px 8px',
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {/* Home button */}
      <button className="sidebar-item" onClick={() => onNavigate('home')}
        style={{
          marginBottom: 6, fontWeight: 600, gap: 10, padding: '8px 14px',
          background: 'var(--accent-gradient-soft)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-md)',
        }}>
        <div style={SLOT}>
          <SystemIcon path={specialIcons['home'] || null} isDir={false} name="home" size={20} iconPath={specialIcons['home'] || null} />
        </div>
        <span>Home</span>
      </button>

      <div className="anim-slide-left">
        <button className="section-header" onClick={() => toggle('pinned')}>
          <span className={`chevron ${expanded.has('pinned') ? 'open' : ''}`}>▶</span>
          Quick Access
        </button>
        {expanded.has('pinned') && (
          <div className="stagger-children" style={{ padding: '2px 2px' }}>
            {pinnedFolders.map(f => (
              <button key={f.path}
                className={`sidebar-item sidebar-item-bold ${isActive(f.path) ? 'active nav-active-indicator' : ''}`}
                onClick={() => onNavigate(f.path)}
              >
                <div style={SLOT}>
                  <SystemIcon path={specialIcons[f.icon] || null} isDir={true} name={f.icon} size={20} iconPath={specialIcons[f.icon] || null} />
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{f.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Applications */}
      <div className="anim-slide-left" style={{ animationDelay: '30ms' }}>
        <button
          className={`sidebar-item ${activeView === 'applications' ? 'active nav-active-indicator' : ''}`}
          onClick={onShowApplications}
          style={{ margin: '4px 2px', fontWeight: 500, gap: 10, padding: '8px 14px' }}
        >
          <div style={SLOT}>
            <SystemIcon path={appsIcon} isDir={false} name="applications" size={20} iconPath={appsIcon} />
          </div>
          <span>Applications</span>
        </button>
      </div>

      {/* Recycle Bin */}
      {trash && (
        <div className="anim-slide-left" style={{ animationDelay: '40ms' }}>
          <button
            className={`sidebar-item ${isActive(trash.path) ? 'active nav-active-indicator' : ''}`}
            onClick={() => onNavigate(trash.path)}
            style={{ margin: '4px 2px', fontWeight: 500, gap: 10, padding: '8px 14px' }}
          >
            <div style={SLOT}>
              <SystemIcon path={specialIcons['trash'] || null} isDir={false} name="trash" size={20} iconPath={specialIcons['trash'] || null} />
            </div>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Recycle Bin</span>
            {trash.count > 0 && (
              <span style={{
                fontSize: 10.5, fontWeight: 600, color: 'var(--text-tertiary)',
                background: 'var(--bg-active)', borderRadius: 8,
                padding: '1px 7px', flexShrink: 0,
              }}>{trash.count}</span>
            )}
          </button>
        </div>
      )}

      {drives.length > 0 && (
        <div className="anim-slide-left" style={{ animationDelay: '50ms' }}>
          <button className="section-header" onClick={() => toggle('drives')}>
            <span className={`chevron ${expanded.has('drives') ? 'open' : ''}`}>▶</span>
            Devices
          </button>
          {expanded.has('drives') && (
            <div className="stagger-children" style={{ padding: '2px 2px' }}>
              {drives.map(d => (
                <button key={d.path}
                  className={`sidebar-item ${isActive(d.path) ? 'active nav-active-indicator' : ''}`}
                  onClick={() => onNavigate(d.path)}
                >
                  <div style={SLOT}>
                    <SystemIcon path={specialIcons['drive'] || null} isDir={false} name="drive" size={20} iconPath={specialIcons['drive'] || null} />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{d.name}</span>
                    {d.total > 0 && (
                      <>
                        <div className="usage-bar">
                          <div className="usage-bar-fill" style={{ width: `${(d.total - d.free) / d.total * 100}%` }} />
                        </div>
                        <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>{fmt(d.total - d.free)} / {fmt(d.total)}</span>
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
