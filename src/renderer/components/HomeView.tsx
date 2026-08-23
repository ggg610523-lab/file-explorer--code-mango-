import React, { useState, useEffect } from 'react';
import { FileItem } from '../types';
import { SystemIcon } from './SystemIcon';

interface Props {
  onNavigate: (path: string) => void;
  onOpenRecent?: (path: string) => void;
}

function fmt(b: number): string {
  if (!b) return '—';
  const u = ['B','KB','MB','GB','TB']; let i = 0, s = b;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
}

function relDate(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function timeString(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function dateString(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function fileExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function extColor(ext: string): string {
  const map: Record<string, string> = {
    pdf: '#ef4444', doc: '#3b82f6', docx: '#3b82f6', txt: '#6b7280', md: '#6b7280',
    xls: '#22c55e', xlsx: '#22c55e', csv: '#22c55e',
    ppt: '#f97316', pptx: '#f97316',
    jpg: '#a855f7', jpeg: '#a855f7', png: '#a855f7', gif: '#a855f7', svg: '#a855f7', webp: '#a855f7',
    mp4: '#ef4444', mkv: '#ef4444', avi: '#ef4444', mov: '#ef4444',
    mp3: '#ec4899', wav: '#ec4899', flac: '#ec4899', ogg: '#ec4899',
    zip: '#f59e0b', tar: '#f59e0b', gz: '#f59e0b', '7z': '#f59e0b',
    js: '#eab308', ts: '#3178c6', py: '#3572a5', rs: '#dea584', go: '#00add8',
    cpp: '#f34b7d', c: '#555555', java: '#b07219', html: '#e34c26', css: '#563d7c',
    sh: '#89e051', bash: '#89e051',
  };
  return map[ext] || '#6b7280';
}

function fileIcon(name: string) {
  const ext = fileExt(name);
  const col = extColor(ext);
  return (
    <div style={{
      width: 34, height: 34, borderRadius: 8,
      background: `${col}14`, border: `1px solid ${col}22`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      fontSize: 10, fontWeight: 700, color: col, letterSpacing: -0.3,
      textTransform: 'uppercase',
    }}>
      {ext || '?'}
    </div>
  );
}

export function HomeView({ onNavigate, onOpenRecent }: Props) {
  const [recent, setRecent] = useState<FileItem[]>([]);
  const [pinned, setPinned] = useState<{ name: string; path: string; icon: string }[]>([]);
  const [drives, setDrives] = useState<{ name: string; path: string; total: number; free: number }[]>([]);
  const [specialIcons, setSpecialIcons] = useState<Record<string, string | null>>({});
  const [time, setTime] = useState(timeString());

  useEffect(() => {
    window.api.getRecentFiles().then(setRecent);
    window.api.getPinnedFolders().then(setPinned);
    window.api.getDrives().then(setDrives);
    window.api.getSpecialIcons().then(setSpecialIcons);
    const t = setInterval(() => setTime(timeString()), 30000);
    const unsub = window.api.onDrivesChanged(() => {
      window.api.getDrives().then(setDrives);
    });
    return () => { clearInterval(t); unsub(); };
  }, []);

  const accentForFolder = (name: string): string => {
    const map: Record<string, string> = {
      'Home': '#3b82f6', 'Desktop': '#8b5cf6', 'Documents': '#06b6d4',
      'Downloads': '#22c55e', 'Music': '#ec4899', 'Pictures': '#a855f7',
      'Videos': '#ef4444', 'Templates': '#f97316', 'Projects': '#6366f1',
    };
    return map[name] || '#6b7280';
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px 40px', maxWidth: 860, margin: '0 auto', width: '100%' }}>

      {/* Hero greeting */}
      <div className="anim-fade-in" style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{
              fontSize: 30, fontWeight: 800, color: 'var(--text-primary)',
              marginBottom: 2, letterSpacing: '-0.03em', lineHeight: 1.15,
            }}>
              {greeting()}<span style={{
                background: 'var(--accent-gradient-vivid)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>.</span>
            </h1>
            <p style={{ fontSize: 13.5, color: 'var(--text-tertiary)', fontWeight: 400, marginTop: 3 }}>
              {dateString()}
            </p>
          </div>
          <div style={{
            fontSize: 30, fontWeight: 700, color: 'var(--text-secondary)',
            fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em',
            lineHeight: 1.15, textAlign: 'right', flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            {time}
          </div>
        </div>
      </div>

      {/* Quick Access */}
      <div className="anim-fade-in" style={{ marginBottom: 32, animationDelay: '40ms' }}>
        <SectionHeader label="Quick Access" count={pinned.length}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </SectionHeader>
        <div className="stagger-children" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 8,
        }}>
          {pinned.map(f => {
            const col = accentForFolder(f.name);
            return (
              <div key={f.path} onClick={() => onNavigate(f.path)} className="home-card"
                style={{ gap: 12 }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 11,
                  background: `linear-gradient(135deg, ${col}18, ${col}08)`,
                  border: `1px solid ${col}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'transform 0.22s var(--ease-out)',
                }}>
                  <SystemIcon path={specialIcons[f.icon] || null} isDir={true} name={f.icon} size={22} iconPath={specialIcons[f.icon] || null} />
                </div>
                <div style={{ overflow: 'hidden', minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 500, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                  }}>{f.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Storage + Recent side by side on wider screens */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>

        {/* Storage */}
        {drives.length > 0 && (
          <div className="anim-fade-in" style={{ flex: '1 1 260px', minWidth: 240, animationDelay: '80ms' }}>
            <SectionHeader label="Storage" count={drives.length}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4M14 12h4"/>
              </svg>
            </SectionHeader>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            }}>
              {drives.map((d, i) => {
                const used = d.total - d.free;
                const pct = d.total > 0 ? (used / d.total) * 100 : 0;
                const barColor = pct > 90 ? '#ef4444' : pct > 70 ? '#f59e0b' : 'var(--accent)';
                return (
                  <div key={d.path} onClick={() => onNavigate(d.path)}
                    className="home-storage-item"
                    style={{
                      padding: '14px 18px', cursor: 'pointer',
                      transition: 'background 0.12s var(--ease-out)',
                      borderBottom: i < drives.length - 1 ? '1px solid var(--border-primary)' : 'none',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-surface)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: 'var(--accent-gradient-soft)',
                        border: '1px solid var(--border-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                      }}>
                        <SystemIcon path={specialIcons['drive'] || null} isDir={false} name="drive" size={18} iconPath={specialIcons['drive'] || null} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 1 }}>{fmt(used)} of {fmt(d.total)}</div>
                      </div>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: barColor,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {Math.round(pct)}%
                      </div>
                    </div>
                    {/* Usage bar */}
                    <div style={{
                      width: '100%', height: 5, borderRadius: 3,
                      background: 'var(--bg-active)', overflow: 'hidden',
                    }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 3,
                        background: barColor,
                        transition: 'width 0.6s var(--ease-out)',
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent Files */}
        {recent.length > 0 && (
          <div className="anim-fade-in" style={{ flex: '1 1 300px', minWidth: 280, animationDelay: '120ms' }}>
            <SectionHeader label="Recent Files" count={recent.length}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </SectionHeader>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border-primary)',
              borderRadius: 'var(--radius-lg)', overflow: 'hidden',
            }}>
              {recent.map((f, i) => (
                <div key={f.path} onClick={() => onOpenRecent ? onOpenRecent(f.path) : onNavigate(f.path.replace(/\/[^/]+$/, ''))}
                  className="home-recent-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 16px', cursor: 'pointer',
                    transition: 'background 0.12s var(--ease-out)',
                    borderBottom: i < recent.length - 1 ? '1px solid var(--border-primary)' : 'none',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-surface)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {fileIcon(f.name)}
                  <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                    <span style={{
                      fontSize: 13, fontWeight: 500, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block',
                    }}>{f.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                      {f.parentDir ? `${f.parentDir} · ` : ''}{relDate(f.modified)}
                    </span>
                  </div>
                  <span style={{
                    fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0,
                    fontVariantNumeric: 'tabular-nums',
                  }}>{fmt(f.size)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)',
      textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 10,
      display: 'flex', alignItems: 'center', gap: 6,
    }}>
      <span style={{
        width: 18, height: 18, borderRadius: 5,
        background: 'var(--accent-gradient)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', flexShrink: 0,
      }}>
        {children}
      </span>
      {label}
      {count !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)',
          background: 'var(--bg-active)', borderRadius: 6,
          padding: '1px 6px', marginLeft: 2,
        }}>{count}</span>
      )}
    </div>
  );
}
