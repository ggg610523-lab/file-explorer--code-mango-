import React, { useState, useEffect } from 'react';

interface FileInfo {
  name: string; path: string;
  isDirectory: boolean; isFile: boolean; isSymlink: boolean;
  size: number; modified: string; created: string; permissions: string;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '0 B';
  const u = ['B','KB','MB','GB','TB']; let i = 0, s = bytes;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(i > 0 ? 1 : 0)} ${u[i]}`;
}

function fmtDate(iso: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

interface Props {
  filePath: string | null;
  onClose: () => void;
}

export function PropertiesModal({ filePath, onClose }: Props) {
  const [info, setInfo] = useState<FileInfo | null>(null);
  const [ownerRead, setOwnerRead] = useState(true);
  const [ownerWrite, setOwnerWrite] = useState(true);
  const [ownerExec, setOwnerExec] = useState(false);
  const [groupRead, setGroupRead] = useState(true);
  const [groupWrite, setGroupWrite] = useState(false);
  const [groupExec, setGroupExec] = useState(false);
  const [otherRead, setOtherRead] = useState(true);
  const [otherWrite, setOtherWrite] = useState(false);
  const [otherExec, setOtherExec] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!filePath) return;
    let mounted = true;
    window.api.getFileInfo(filePath).then(data => {
      if (!mounted || !data) return;
      setInfo(data);
      // Parse permissions string (e.g. "644")
      const perms = (data.permissions || '').replace(/[^0-7]/g, '').slice(-3).padStart(3, '0');
      const oct = perms.split('').map(Number);
      setOwnerRead(!!(oct[0] & 4));
      setOwnerWrite(!!(oct[0] & 2));
      setOwnerExec(!!(oct[0] & 1));
      setGroupRead(!!(oct[1] & 4));
      setGroupWrite(!!(oct[1] & 2));
      setGroupExec(!!(oct[1] & 1));
      setOtherRead(!!(oct[2] & 4));
      setOtherWrite(!!(oct[2] & 2));
      setOtherExec(!!(oct[2] & 1));
    });
    return () => { mounted = false; };
  }, [filePath]);

  const octalStr = ((ownerRead?4:0)+(ownerWrite?2:0)+(ownerExec?1:0)).toString()
    + ((groupRead?4:0)+(groupWrite?2:0)+(groupExec?1:0)).toString()
    + ((otherRead?4:0)+(otherWrite?2:0)+(otherExec?1:0)).toString();
  const permNum = parseInt(octalStr, 8);

  const handleSave = async () => {
    if (!filePath) return;
    setSaving(true);
    await window.api.setPermissions(filePath, permNum);
    const updated = await window.api.getFileInfo(filePath);
    if (updated) setInfo(updated);
    setSaving(false);
  };

  if (!filePath || !info) return null;

  const ext = info.name.includes('.') ? info.name.split('.').pop()?.toUpperCase() || '' : '';
  const type = info.isDirectory ? 'Folder' : info.isSymlink ? 'Symbolic Link' : ext ? `${ext} File` : 'File';

  return (
    <div className="properties-overlay" onClick={onClose}>
      <div className="properties-dialog anim-scale-in" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px 16px', borderBottom: '1px solid var(--border-primary)' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 'var(--radius-lg)',
            background: info.isDirectory ? 'var(--accent-gradient-soft)' : 'var(--bg-active)',
            border: '1px solid var(--border-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'var(--shadow-sm)',
          }}>
            {info.isDirectory ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {info.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{type}</div>
          </div>
        </div>

        {/* Details */}
        <div style={{ padding: '16px 24px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <PropRow label="Location" value={info.path.replace(/\/[^/]+$/, '')} />
          <PropRow label="Size" value={info.isDirectory ? '—' : fmtSize(info.size)} />
          <PropRow label="Created" value={fmtDate(info.created)} />
          <PropRow label="Modified" value={fmtDate(info.modified)} />
          <PropRow label="Permissions" value={`${octalStr} (${fmtPermsOctal(octalStr)})`} />
        </div>

        {/* Permissions editor */}
        <div style={{ padding: '0 24px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Change Permissions
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr',
            gap: '6px 12px', alignItems: 'center',
            fontSize: 12, color: 'var(--text-secondary)',
          }}>
            {/* Header */}
            <div />
            <div style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-tertiary)' }}>Read</div>
            <div style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-tertiary)' }}>Write</div>
            <div style={{ textAlign: 'center', fontWeight: 600, color: 'var(--text-tertiary)' }}>Exec</div>
            {/* Owner */}
            <div style={{ fontWeight: 500 }}>Owner</div>
            <PermCheck checked={ownerRead} onChange={setOwnerRead} />
            <PermCheck checked={ownerWrite} onChange={setOwnerWrite} />
            <PermCheck checked={ownerExec} onChange={setOwnerExec} />
            {/* Group */}
            <div style={{ fontWeight: 500 }}>Group</div>
            <PermCheck checked={groupRead} onChange={setGroupRead} />
            <PermCheck checked={groupWrite} onChange={setGroupWrite} />
            <PermCheck checked={groupExec} onChange={setGroupExec} />
            {/* Other */}
            <div style={{ fontWeight: 500 }}>Other</div>
            <PermCheck checked={otherRead} onChange={setOtherRead} />
            <PermCheck checked={otherWrite} onChange={setOtherWrite} />
            <PermCheck checked={otherExec} onChange={setOtherExec} />
          </div>
        </div>

        {/* Buttons */}
        <div style={{ padding: '0 24px 16px', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="properties-close-btn" onClick={onClose}
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}>
            Cancel
          </button>
          <button className="properties-close-btn" onClick={handleSave} disabled={saving}
            style={{ opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PermCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: 'var(--accent)', cursor: 'pointer' }} />
      </label>
    </div>
  );
}

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
      <span style={{ width: 90, flexShrink: 0, fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontSize: 12.5, color: 'var(--text-primary)', wordBreak: 'break-all', lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

function fmtPermsOctal(octal: string): string {
  const perms = ['---','--x','-w-','-wx','r--','r-x','rw-','rwx'];
  return `${perms[parseInt(octal[0])] || '?'}/${perms[parseInt(octal[1])] || '?'}/${perms[parseInt(octal[2])] || '?'}`;
}
