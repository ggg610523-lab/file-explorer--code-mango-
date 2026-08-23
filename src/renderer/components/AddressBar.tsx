import React, { useState, useEffect, useRef } from 'react';

interface Props {
  path: string;
  onNavigate: (path: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onGoHome: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onSearch: (query: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

export function AddressBar({ path, onNavigate, onGoBack, onGoForward, onGoUp, onGoHome, canGoBack, canGoForward, onSearch, searchQuery, onSearchQueryChange }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(path);
  const [searchFocused, setSearchFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setEditValue(path); }, [path]);

  // Clear stale search text when navigating away
  const prevPathRef = useRef(path);
  useEffect(() => {
    if (path !== prevPathRef.current) {
      prevPathRef.current = path;
      if (searchQuery) onSearchQueryChange('');
    }
  }, [path, searchQuery, onSearchQueryChange]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editValue.trim()) onNavigate(editValue.trim());
    setIsEditing(false);
  };

  const pathParts = path.split('/').filter(Boolean);

  return (
    <div className="anim-fade-in address-bar-row" style={{
      display: 'flex', alignItems: 'center', height: 'var(--addressbar-h)',
      padding: '0 14px', gap: 6,
      borderBottom: '1px solid var(--border-primary)',
      background: 'var(--bg-primary)',
    }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
        <button className="nav-btn" onClick={onGoHome} title="Home">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
        <button className="nav-btn" onClick={onGoBack} disabled={!canGoBack} title="Back (Alt+←)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button className="nav-btn" onClick={onGoForward} disabled={!canGoForward} title="Forward (Alt+→)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <button className="nav-btn" onClick={onGoUp} title="Up (Alt+↑)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} style={{ flex: 1 }}>
          <input ref={inputRef} value={editValue} onChange={e => setEditValue(e.target.value)}
            onBlur={() => setIsEditing(false)} autoFocus style={{
              width: '100%', height: 32, padding: '0 14px',
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-focus)', borderRadius: 'var(--radius-pill)',
              outline: 'none', fontSize: 12.5,
              boxShadow: '0 0 0 3px rgba(26,115,232,0.1)',
              animation: 'fadeIn 0.12s var(--ease-out)',
            }} />
        </form>
      ) : (
        <div className="breadcrumb" onClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}>
          {pathParts.length === 0 ? (
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12.5 }}>Root</span>
          ) : (
            <>
              <span className="breadcrumb-part link" onClick={e => { e.stopPropagation(); onNavigate('/'); }}>/</span>
              {pathParts.map((part, i) => (
                <React.Fragment key={i}>
                  <span className="breadcrumb-sep">/</span>
                  <span
                    className={`breadcrumb-part ${i === pathParts.length - 1 ? 'current' : 'link'}`}
                    onClick={e => { e.stopPropagation(); onNavigate('/' + pathParts.slice(0, i + 1).join('/')); }}
                  >{part}</span>
                </React.Fragment>
              ))}
            </>
          )}
        </div>
      )}

      <div style={{ flexShrink: 0 }}>
        <input className="search-pill" value={searchQuery}
          placeholder="Search"
          onChange={e => { onSearchQueryChange(e.target.value); onSearch(e.target.value); }}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
          style={{ width: searchFocused ? 240 : 160 } as React.CSSProperties} />
      </div>
    </div>
  );
}
