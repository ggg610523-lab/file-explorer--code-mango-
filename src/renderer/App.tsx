import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { TabBar } from './components/TabBar';
import { NavigationPane } from './components/NavigationPane';
import { AddressBar } from './components/AddressBar';
import { ToolBar } from './components/ToolBar';
import { FileView } from './components/FileView';
import { ContextMenu } from './components/ContextMenu';
import { StatusBar } from './components/StatusBar';
import { HomeView } from './components/HomeView';
import { CopyProgress } from './components/CopyProgress';
import { PropertiesModal } from './components/PropertiesModal';
import { ApplicationsView } from './components/ApplicationsView';
import PreviewPanel from './components/PreviewPanel';
import { useTheme } from './hooks/useTheme';
import { useFileSystem } from './hooks/useFileSystem';
import { FileItem } from './types';
import { FpsDebug } from './utils';
import './theme.css';

export function App() {
  const { theme, themeMode, setTheme } = useTheme();
  const fs = useFileSystem();
  const [ctx, setCtx] = useState<{ visible: boolean; x: number; y: number; items: any[] }>({
    visible: false, x: 0, y: 0, items: [],
  });
  const [showHome, setShowHome] = useState(false);
  const [showApplications, setShowApplications] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingRename, setPendingRename] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [openWith, setOpenWith] = useState<{ visible: boolean; x: number; y: number; apps: { name: string; exec: string }[]; filePath: string }>({
    visible: false, x: 0, y: 0, apps: [], filePath: '',
  });
  const [propertiesPath, setPropertiesPath] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [trashPath, setTrashPath] = useState<string | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const rafRef = useRef<number>(0);
  const pendingSelectRef = useRef<string[] | null>(null);

  // Select extracted item(s) by path after a directory refresh completes
  useEffect(() => {
    if (pendingSelectRef.current) {
      const paths = pendingSelectRef.current;
      pendingSelectRef.current = null;
      if (paths.length === 0) return;
      fs.clearSelection();
      for (const p of paths) {
        if (fs.files.some(f => f.path === p)) fs.toggleFileSelection(p, true);
      }
    }
  }, [fs.files, fs]);

  useEffect(() => {
    const onResize = () => {
      appRef.current?.classList.add('resizing');
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => appRef.current?.classList.remove('resizing'), 200);
      });
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e: React.DragEvent, item: FileItem | null) => {
    const paths = item
      ? (fs.selectedFiles.has(item.path) ? Array.from(fs.selectedFiles) : [item.path])
      : [];
    if (paths.length === 0) return;
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
    window.api.startDrag(paths);
  }, [fs.selectedFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy';
  }, []);

  const handleDragOverItem = useCallback((e: React.DragEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (item.isDirectory) {
      e.dataTransfer.dropEffect = e.shiftKey ? 'move' : 'copy';
      setDropTarget(item.path);
    }
  }, []);

  const handleDragLeaveItem = useCallback(() => { setDropTarget(null); }, []);

  const handleDropOnItem = useCallback(async (e: React.DragEvent, item: FileItem) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    if (!item.isDirectory) return;

    let paths: string[] = [];
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      paths = text.split('\n').filter(Boolean);
    } else {
      paths = await window.api.getDragPaths();
    }
    if (paths.length === 0) return;

    const isMove = e.shiftKey;
    if (isMove) await window.api.moveItems(paths, item.path);
    else await window.api.copyItems(paths, item.path);
    window.api.endDrag();
    fs.refreshCurrentDir();
  }, [fs]);

  const handleDropOnBg = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const tab = fs.getActiveTab();
    if (!tab) return;

    let paths: string[] = [];
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      paths = text.split('\n').filter(Boolean);
    } else {
      paths = await window.api.getDragPaths();
    }
    if (paths.length === 0) return;

    const isMove = e.shiftKey;
    if (isMove) await window.api.moveItems(paths, tab.path);
    else await window.api.copyItems(paths, tab.path);
    window.api.endDrag();
    fs.refreshCurrentDir();
  }, [fs]);

  const handleDragEnd = useCallback(() => {
    window.api.endDrag();
    setDropTarget(null);
  }, []);

  useEffect(() => {
    window.api.getInitialPath().then(p => fs.createTab(p || undefined));
    window.api.getTrashInfo().then(info => setTrashPath(info.path || null));
    new FpsDebug();
  }, []);

  const activeTab = fs.getActiveTab();

  useEffect(() => {
    if (activeTab) { fs.loadTabFiles(activeTab.id); setShowHome(false); }
  }, [activeTab?.id]);

  const nav = useCallback((path: string) => {
    if (activeTab) { fs.navigateTo(activeTab.id, path); setShowHome(false); setSidebarOpen(false); }
  }, [activeTab]);

  const back = useCallback(() => { if (activeTab) fs.goBack(activeTab.id); }, [activeTab]);
  const fwd = useCallback(() => { if (activeTab) fs.goForward(activeTab.id); }, [activeTab]);
  const up = useCallback(() => { if (activeTab) fs.goUp(activeTab.id); }, [activeTab]);
  const goHome = useCallback(() => { setShowHome(true); }, []);

  const openRecent = useCallback((path: string) => {
    const parentDir = path.replace(/\/[^/]+$/, '');
    const tab = fs.getActiveTab();
    if (tab && tab.path === parentDir) {
      fs.clearSelection();
      fs.toggleFileSelection(path, true);
    } else {
      pendingSelectRef.current = [path];
      nav(parentDir);
    }
  }, [nav, fs]);

  const handleFileOpen = useCallback((path: string, isDir: boolean) => {
    if (isDir) nav(path);
    else window.api.openItem(path);
  }, [nav]);

  const handleFileRename = useCallback((path: string, name: string) => {
    fs.renameFile(path, name);
    setPendingRename(null);
  }, [fs]);

  const newFolder = useCallback(async () => {
    let name = 'New Folder', c = 1;
    while (fs.files.some(f => f.name === name)) name = `New Folder (${c++})`;
    await fs.createNewFolder(name);
  }, [fs.files]);

  const newFile = useCallback(async () => {
    let name = 'Untitled.txt', c = 1;
    while (fs.files.some(f => f.name === name)) name = `Untitled (${c++}).txt`;
    await fs.createNewFile(name);
  }, [fs.files]);

  const handleExtractToDesktop = useCallback(async (archiveName: string, archivePath: string) => {
    const homeDir = await window.api.getHomeDir();
    const baseName = archiveName.replace(/\.(zip|tar|gz|bz2|xz|7z|rar)$/i, '');
    const dest = `${homeDir}/Desktop/${baseName}`;
    const res = await window.api.extractArchive(archivePath, dest);
    if (res.success) {
      setPreviewFile(null);
      fs.clearSelection();
      nav(dest);
      pendingSelectRef.current = res.created || [];
    } else {
      alert(`Extraction failed: ${res.error}`);
    }
  }, [fs, nav]);

  const handleExtractHere = useCallback(async (archivePath: string) => {
    const destDir = archivePath.substring(0, archivePath.lastIndexOf('/'));
    const res = await window.api.extractArchive(archivePath, destDir);
    if (res.success) {
      fs.clearSelection();
      await fs.refreshCurrentDir();
      pendingSelectRef.current = res.created || [];
    }
    else alert(`Extraction failed: ${res.error}`);
  }, [fs]);

  const handleCompress = useCallback(async () => {
    const paths = fs.selectedFiles.size > 0 ? Array.from(fs.selectedFiles) : [];
    const tab = activeTab;
    if (!tab || paths.length === 0) return;
    const currentDir = tab.path;
    const lastSlash = currentDir.lastIndexOf('/');
    const folderName = lastSlash >= 0 ? currentDir.slice(lastSlash + 1) : currentDir;
    let baseName: string;
    if (paths.length === 1) {
      const name = paths[0].split('/').pop() || '';
      const dot = name.lastIndexOf('.');
      baseName = dot > 0 ? name.slice(0, dot) : name;
    } else {
      baseName = folderName;
    }
    let archivePath = `${currentDir}/${baseName}.zip`;
    let counter = 1;
    while (fs.files.some(f => f.path === archivePath)) {
      archivePath = `${currentDir}/${baseName} (${counter++}).zip`;
    }
    const res = await window.api.createArchive(paths, archivePath);
    if (res.success) fs.refreshCurrentDir();
    else alert(`Compression failed: ${res.error}`);
  }, [fs, activeTab]);

  const showCtx = useCallback((e: React.MouseEvent, item: FileItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenWith(p => ({ ...p, visible: false }));
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.svg', '.heic', '.heif'];
    const isImage = item && !item.isDirectory && imageExts.some(ext => item.name.toLowerCase().endsWith(ext));
    const archiveExts = ['.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar'];
    const isArchive = item && !item.isDirectory && archiveExts.some(ext => item.name.toLowerCase().endsWith(ext));
    const items = item ? [
      { label: 'Open', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>, action: () => { if (item.isDirectory) nav(item.path); else window.api.openItem(item.path); } },
      ...(!item.isDirectory ? [{ label: 'Open With...', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>, action: async () => {
        const apps = await window.api.getOpenWithApps(item.path);
        setOpenWith({ visible: true, x: e.clientX, y: e.clientY, apps, filePath: item.path });
      }}] : []),
      { divider: true },
      { label: 'Cut', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>, action: () => { fs.toggleFileSelection(item.path, false); fs.cutFiles(); } },
      { label: 'Copy', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>, action: () => { fs.toggleFileSelection(item.path, false); fs.copyFiles(); } },
      { divider: true },
      ...(isImage ? [
        { label: 'Set as desktop background', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>, action: async () => {
          const result = await window.api.setWallpaper(item.path);
          if (!result.success) console.error('Failed to set wallpaper:', result.error);
        }},
        { divider: true },
      ] : []),
      { label: 'Open in Terminal', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>, action: () => {
        const dir = item.isDirectory ? item.path : item.path.replace(/\/[^/]+$/, '');
        window.api.openInTerminal(dir);
      }},
      { divider: true },
      { label: 'Rename', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>, action: () => {
        setPendingRename(item.path);
      }},
      { label: 'Delete', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>, action: () => { fs.toggleFileSelection(item.path, false); fs.deleteFiles(); } },
      { label: 'Compress', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>, action: handleCompress },
      ...(isArchive ? [
        { label: 'Extract Here', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>, action: () => handleExtractHere(item.path) },
        { label: 'Extract to Desktop', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><circle cx="17" cy="6" r="0.5"/><circle cx="17" cy="12" r="0.5"/><circle cx="17" cy="18" r="0.5"/></svg>, action: () => handleExtractToDesktop(item.name, item.path) },
      ] : []),
      { divider: true },
      { label: 'Properties', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>, action: () => setPropertiesPath(item.path) },
    ] : [
      { label: 'New Folder', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>, action: newFolder },
      { label: 'New Text File', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>, action: newFile },
      { divider: true },
      { label: 'Paste', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>, action: () => fs.pasteFiles(), disabled: !fs.clipboard },
      { divider: true },
      { label: 'Select All', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>, action: () => fs.selectAll() },
      { divider: true },
      { label: 'Refresh', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>, action: () => fs.refreshCurrentDir() },
      { divider: true },
      { label: 'Open in Terminal', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>, action: () => {
        window.api.openInTerminal(activeTab?.path || '/');
      }},
    ];
    const isTrashView = activeTab?.path === trashPath;
    let menuItems = items;
    if (isTrashView) {
      menuItems = item ? [
        { label: 'Restore', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>, action: async () => {
          const res = await window.api.restoreItem(item.path);
          if (!res.success) alert(`Restore failed: ${res.error}`);
          else fs.refreshCurrentDir();
        }},
        { label: 'Copy', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>, action: () => { fs.toggleFileSelection(item.path, false); fs.copyFiles(); } },
        { divider: true },
        { label: 'Delete permanently', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>, action: () => { fs.toggleFileSelection(item.path, false); fs.deleteFiles(); } },
        { divider: true },
        { label: 'Properties', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>, action: () => setPropertiesPath(item.path) },
      ] : [
        { label: 'Empty Trash', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>, action: async () => {
          if (window.confirm('Empty the Recycle Bin? All items will be permanently deleted.')) {
            const res = await window.api.emptyTrash();
            if (!res.success) alert(`Empty trash failed: ${res.error}`);
            else fs.refreshCurrentDir();
          }
        }},
        { divider: true },
        { label: 'Refresh', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>, action: () => fs.refreshCurrentDir() },
        { divider: true },
        { label: 'Open in Terminal', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>, action: () => window.api.openInTerminal(activeTab?.path || '/') },
      ];
    }
    setCtx({ visible: true, x: e.clientX, y: e.clientY, items: menuItems });
  }, [fs, nav, newFolder, activeTab, handleCompress, handleExtractHere, handleExtractToDesktop, trashPath]);

  // ── Preview Panel ──────────────────────────────────────────────────────────
  const handleTogglePreview = useCallback(() => {
    if (previewFile) {
      setPreviewFile(null);
    } else if (fs.selectedFiles.size === 1 && !showHome && !showApplications) {
      const selPath = Array.from(fs.selectedFiles)[0];
      const file = fs.files.find(f => f.path === selPath);
      if (file) setPreviewFile(file);
    }
  }, [previewFile, fs.selectedFiles, fs.files, showHome, showApplications]);

  const handlePreviewOpen = useCallback(() => {
    if (!previewFile) return;
    if (previewFile.isDirectory) nav(previewFile.path);
    else window.api.openItem(previewFile.path);
  }, [previewFile, nav]);

  const handlePreviewOpenWith = useCallback(async (path: string) => {
    const apps = await window.api.getOpenWithApps(path);
    setOpenWith({ visible: true, x: 200, y: 200, apps, filePath: path });
  }, []);

  const handlePreviewDelete = useCallback(() => {
    fs.deleteFiles();
  }, [fs]);

  const handlePreviewClose = useCallback(() => {
    setPreviewFile(null);
    fs.clearSelection();
  }, [fs]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'c') { e.preventDefault(); fs.copyFiles(); }
      if (mod && e.key === 'x') { e.preventDefault(); fs.cutFiles(); }
      if (mod && e.key === 'v') { e.preventDefault(); fs.pasteFiles(); }
      if (e.key === 'Delete') fs.deleteFiles();
      if (mod && e.key === 'n') { e.preventDefault(); newFolder(); }
      if (mod && e.shiftKey && e.key === 'N') { e.preventDefault(); newFile(); }
      if (mod && e.key === 't') { e.preventDefault(); fs.createTab(); }
      if (mod && e.key === 'w') { e.preventDefault(); if (activeTab) fs.closeTab(activeTab.id); }
      if (e.key === 'F5') { e.preventDefault(); fs.refreshCurrentDir(); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); fwd(); }
      if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); up(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [fs, activeTab, back, fwd, up, newFolder]);

  return (
    <div ref={appRef} className="app-container">
      <TabBar tabs={fs.tabs} activeTabId={fs.activeTabId}
        onTabClick={(id) => { fs.setActiveTabId(id); setShowHome(false); }}
        onCloseTab={(id) => fs.closeTab(id)}
        onNewTab={() => fs.createTab()}
        themeMode={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onToggleSidebar={() => setSidebarOpen(p => !p)} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
          onClick={() => setSidebarOpen(false)} />
        <div className={`sidebar-wrapper ${sidebarOpen ? 'open' : ''}`}>
          <NavigationPane onNavigate={(p) => { if (p === 'home') { setShowHome(true); setShowApplications(false); } else { nav(p); setShowApplications(false); } }}
            currentPath={activeTab?.path || ''} activeView={showApplications ? 'applications' : showHome ? 'home' : 'files'}
            onShowApplications={() => { setShowApplications(true); setShowHome(false); }} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <AddressBar path={activeTab?.path || ''} onNavigate={nav}
            onGoBack={back} onGoForward={fwd} onGoUp={up} onGoHome={goHome}
            canGoBack={activeTab ? activeTab.historyIndex > 0 : false}
            canGoForward={activeTab ? activeTab.historyIndex < activeTab.history.length - 1 : false}
            onSearch={fs.search} searchQuery={searchQuery} onSearchQueryChange={setSearchQuery} />
          <ToolBar viewMode={fs.viewMode} onViewModeChange={fs.setViewMode}
            onNewFolder={newFolder} onCut={fs.cutFiles} onCopy={fs.copyFiles}
            onPaste={fs.pasteFiles} onDelete={fs.deleteFiles} onRefresh={fs.refreshCurrentDir}
            onOpenTerminal={() => window.api.openInTerminal(activeTab?.path || '/')}
            onSort={fs.sortFiles} sortField={fs.sortField} sortOrder={fs.sortOrder}
            hasSelection={fs.selectedFiles.size > 0} hasClipboard={!!fs.clipboard}
            previewOpen={!!previewFile} onTogglePreview={handleTogglePreview}
            onCompress={handleCompress} />
          {showHome ? (
            <HomeView onNavigate={nav} onOpenRecent={openRecent} />
          ) : showApplications ? (
            <ApplicationsView onOpenTerminal={() => window.api.openInTerminal('/')} onNavigate={nav} />
          ) : (
            <FileView files={fs.sortedFiles} loading={fs.loading} viewMode={fs.viewMode}
              selectedFiles={fs.selectedFiles} onSelect={fs.toggleFileSelection}
              onSelectAll={fs.selectAll} onClearSelection={fs.clearSelection}
              onOpen={handleFileOpen} onRename={handleFileRename}
              onContextMenu={showCtx} isSearching={fs.isSearching}
              animKey={fs.animKey} pendingRename={pendingRename}
              onPendingRenameHandled={() => setPendingRename(null)}
              onDragStart={handleDragStart} onDragOver={handleDragOver}
              onDragOverItem={handleDragOverItem} onDragLeaveItem={handleDragLeaveItem}
              onDropOnItem={handleDropOnItem} onDropOnBg={handleDropOnBg}
              onDragEnd={handleDragEnd} dropTarget={dropTarget} />
          )}
          <StatusBar files={fs.sortedFiles} selectedFiles={fs.selectedFiles}
            currentPath={activeTab?.path || ''} isSearching={fs.isSearching} searchQuery={searchQuery} />
        </div>
      </div>
      {previewFile && (
        <PreviewPanel file={previewFile}
          onClose={handlePreviewClose}
          onOpen={handlePreviewOpen}
          onOpenWith={handlePreviewOpenWith}
          onDelete={handlePreviewDelete}
          onExtractHere={handleExtractHere}
          onExtractToDesktop={handleExtractToDesktop} />
      )}
      <ContextMenu visible={ctx.visible} x={ctx.x} y={ctx.y} items={ctx.items}
        onClose={() => setCtx(p => ({ ...p, visible: false }))} />
      <ContextMenu visible={openWith.visible} x={openWith.x + 10} y={openWith.y}
        items={[
          ...openWith.apps.map(app => ({
            label: app.name,
            icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 9l3 3-3 3"/></svg>,
            action: () => window.api.openWith(openWith.filePath, app.exec),
          })),
        ]}
        onClose={() => setOpenWith(p => ({ ...p, visible: false }))} />
      <CopyProgress />
      <PropertiesModal filePath={propertiesPath} onClose={() => setPropertiesPath(null)} />
    </div>
  );
}
