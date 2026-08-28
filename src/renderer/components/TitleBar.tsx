import React from 'react';

interface Props {
  onToggleSidebar: () => void;
}

export function TitleBar({ onToggleSidebar }: Props) {
  return (
    <div className="titlebar" style={{
      display: 'flex', alignItems: 'center', height: 'var(--titlebar-h)',
      padding: '0 8px', gap: 6,
      flexShrink: 0,
    }}>
      <button className="hamburger-btn" onClick={onToggleSidebar} title="Menu">
        ☰
      </button>
      <div style={{ flex: 1 }} />
    </div>
  );
}
