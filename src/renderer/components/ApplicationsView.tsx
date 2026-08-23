import React, { useState, useEffect, useCallback } from 'react';
import { ContextMenu } from './ContextMenu';

interface AppInfo {
  name: string; exec: string; icon: string | null; desktopFile: string; categories: string;
}

interface Props {
  onOpenTerminal: (path: string) => void;
  onNavigate: (path: string) => void;
}

const CATEGORY_MAP: Record<string, string> = {
  'AudioVideo': 'Multimedia', 'Audio': 'Multimedia', 'Video': 'Multimedia',
  'Development': 'Development', 'Education': 'Education',
  'Game': 'Games', 'Graphics': 'Graphics',
  'Network': 'Internet', 'Office': 'Office',
  'Science': 'Science', 'Settings': 'System',
  'System': 'System', 'Utility': 'Utilities',
};

export function ApplicationsView({ onOpenTerminal, onNavigate }: Props) {
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [ctx, setCtx] = useState<{ visible: boolean; x: number; y: number; app: AppInfo | null }>({
    visible: false, x: 0, y: 0, app: null,
  });

  useEffect(() => {
    window.api.getApplications().then(data => {
      setApps(data);
      setLoading(false);
    });
  }, []);

  const filtered = search
    ? apps.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    : apps;

  const grouped = new Map<string, AppInfo[]>();
  for (const app of filtered) {
    const cats = app.categories.split(';').filter(Boolean);
    const group = cats.length > 0 ? (CATEGORY_MAP[cats[0]] || cats[0]) : 'Other';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(app);
  }

  const openApp = (exec: string) => {
    window.api.launchApp(exec);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, app: AppInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({
      visible: true, x: e.clientX, y: e.clientY, app,
    });
  }, []);

  return (
    <div className="file-view" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{
        padding: '12px 20px 8px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 10px',
          transition: 'border-color 0.15s var(--ease-out), box-shadow 0.15s var(--ease-out), background 0.15s var(--ease-out)',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            placeholder="Search applications..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13, color: 'var(--text-primary)', fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      {/* App list */}
      <div className="file-grid" style={{ flex: 1, overflow: 'auto', padding: '8px 16px 20px' }}>
        {loading ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 120, color: 'var(--text-tertiary)', fontSize: 13,
          }}>
            Loading applications...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: 120, color: 'var(--text-tertiary)', fontSize: 13, gap: 4,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>No applications found</span>
          </div>
        ) : (
          Array.from(grouped.entries()).sort(([a],[b]) => a.localeCompare(b)).map(([group, groupApps]) => (
            <div key={group} className="anim-slide-up" style={{ marginBottom: 20 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                textTransform: 'uppercase', letterSpacing: 0.5,
                padding: '4px 0 6px', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-gradient-soft)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10,
                }}>
                  {groupApps.length}
                </div>
                {group}
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: 6,
              }}>
                {groupApps.map(app => (
                  <button
                    key={app.desktopFile}
                    className="app-item"
                    onClick={() => openApp(app.exec)}
                    onContextMenu={(e) => handleContextMenu(e, app)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                      background: 'transparent', border: '1px solid transparent',
                      cursor: 'pointer', textAlign: 'left',
                      transition: 'background 0.12s var(--ease-out), border-color 0.12s var(--ease-out), transform 0.12s var(--ease-spring)',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{
                      width: 32, height: 32, borderRadius: 'var(--radius-sm)',
                      background: 'var(--bg-active)',
                      border: '1px solid var(--border-primary)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, overflow: 'hidden',
                    }}>
                      {app.icon ? (
                        <img src={app.icon} alt="" style={{ width: 22, height: 22, objectFit: 'contain' }}
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/>
                        </svg>
                      )}
                    </div>
                    <span style={{
                      fontSize: 12.5, color: 'var(--text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {app.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <ContextMenu
        visible={ctx.visible}
        x={ctx.x}
        y={ctx.y}
        items={ctx.app ? [
          { label: 'Open', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>, action: () => openApp(ctx.app!.exec) },
          { divider: true },
          { label: 'Run as Sudo', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, action: async () => {
            const result = await window.api.runWithSudo(ctx.app!.exec);
            if (!result.success) console.error('Failed to run with sudo:', result.error);
          }},
          { divider: true },
          { label: 'Copy Command', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>, action: () => navigator.clipboard.writeText(ctx.app!.exec) },
        ] : []}
        onClose={() => setCtx(p => ({ ...p, visible: false }))}
      />
    </div>
  );
}
