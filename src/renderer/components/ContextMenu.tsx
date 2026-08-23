import React, { useEffect, useRef } from 'react';

interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  action?: () => void;
  divider?: boolean;
  disabled?: boolean;
}

interface Props {
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ visible, x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [visible, onClose]);

  useEffect(() => {
    if (visible && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      if (x + r.width > vw) ref.current.style.left = `${vw - r.width - 8}px`;
      if (y + r.height > vh) ref.current.style.top = `${vh - r.height - 8}px`;
    }
  }, [visible, x, y]);

  if (!visible) return null;

  return (
    <div ref={ref} className="context-menu" style={{ left: x, top: y }}>
      {items.map((item, i) => {
        if (item.divider) return <div key={i} className="context-menu-sep" />;
        return (
          <button key={i}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => { if (!item.disabled && item.action) { item.action(); onClose(); } }}
          >
            <span style={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{item.icon || ''}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
