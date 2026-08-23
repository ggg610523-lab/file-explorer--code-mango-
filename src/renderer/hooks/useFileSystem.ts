import { useState, useCallback, useRef, useMemo } from 'react';
import { FileItem, Tab, ViewMode, SortField, SortOrder, ClipboardData } from '../types';

async function readDir(dirPath: string): Promise<FileItem[]> {
  const result = await window.api.readDirectory(dirPath);
  return result.success ? result.files : [];
}

export function useFileSystem() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('grid-md');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [animKey, setAnimKey] = useState(0);
  const loadSeqRef = useRef(0);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const searchSeqRef = useRef(0);

  const createTab = useCallback(async (path?: string) => {
    const dirPath = path || await window.api.getHomeDir();
    const id = Date.now().toString() + Math.random().toString(36).slice(2);
    const parts = dirPath.split('/').filter(Boolean);
    const title = parts[parts.length - 1] || '/';

    const newTab: Tab = {
      id,
      path: dirPath,
      title,
      history: [dirPath],
      historyIndex: 0,
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(id);
    return id;
  }, []);

  const navigateTo = useCallback(async (tabId: string, dirPath: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (tab.path === dirPath) return;

    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      const newHistory = [...t.history.slice(0, t.historyIndex + 1), dirPath];
      const parts = dirPath.split('/').filter(Boolean);
      return {
        ...t,
        path: dirPath,
        title: parts[parts.length - 1] || '/',
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }));

    if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = undefined; }
    searchSeqRef.current++;
    const seq = ++loadSeqRef.current;
    setSelectedFiles(new Set());
    setIsSearching(false);
    setSearchResults([]);
    setLoading(true);

    const result = await window.api.readDirectory(dirPath);
    if (seq !== loadSeqRef.current) return;
    if (result.success) {
      setFiles(result.files);
    } else {
      setFiles([]);
    }
    setLoading(false);
    setAnimKey(k => k + 1);
  }, [tabs]);

  const loadTabFiles = useCallback(async (tabId: string) => {
    const seq = ++loadSeqRef.current;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;

    setSelectedFiles(new Set());
    setIsSearching(false);
    setLoading(true);

    const result = await window.api.readDirectory(tab.path);
    if (seq !== loadSeqRef.current) return;
    if (result.success) {
      setFiles(result.files);
    } else {
      setFiles([]);
    }
    setLoading(false);
    setAnimKey(k => k + 1);
  }, [tabs]);

  const goBack = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || tab.historyIndex <= 0) return;

    const newIndex = tab.historyIndex - 1;
    const newPath = tab.history[newIndex];

    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      return { ...t, historyIndex: newIndex, path: newPath };
    }));

    if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = undefined; }
    searchSeqRef.current++;
    const seq = ++loadSeqRef.current;
    setSelectedFiles(new Set());
    setIsSearching(false);
    setSearchResults([]);
    setLoading(true);
    const result = await window.api.readDirectory(newPath);
    if (seq !== loadSeqRef.current) return;
    if (result.success) {
      setFiles(result.files);
    } else {
      setFiles([]);
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, historyIndex: tab.historyIndex, path: tab.path } : t));
    }
    setLoading(false);
    setAnimKey(k => k + 1);
  }, [tabs]);

  const goForward = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;

    const newIndex = tab.historyIndex + 1;
    const newPath = tab.history[newIndex];

    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      return { ...t, historyIndex: newIndex, path: newPath };
    }));

    if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = undefined; }
    searchSeqRef.current++;
    const seq = ++loadSeqRef.current;
    setSelectedFiles(new Set());
    setIsSearching(false);
    setSearchResults([]);
    setLoading(true);
    const result = await window.api.readDirectory(newPath);
    if (seq !== loadSeqRef.current) return;
    if (result.success) {
      setFiles(result.files);
    } else {
      setFiles([]);
      setTabs(prev => prev.map(t => t.id === tabId ? { ...t, historyIndex: tab.historyIndex, path: tab.path } : t));
    }
    setLoading(false);
    setAnimKey(k => k + 1);
  }, [tabs]);

  const goUp = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    const parent = tab.path.split('/').slice(0, -1).join('/') || '/';
    navigateTo(tabId, parent);
  }, [tabs, navigateTo]);

  const closeTab = useCallback(async (tabId: string) => {
    let newActiveId: string | null = null;
    let newPath: string | null = null;

    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === tabId);
      const remaining = prev.filter(t => t.id !== tabId);
      if (remaining.length === 0) return prev;

      if (activeTabId === tabId) {
        const newIdx = Math.min(idx, remaining.length - 1);
        newActiveId = remaining[newIdx].id;
        newPath = remaining[newIdx].path;
        setActiveTabId(remaining[newIdx].id);
      }
      return remaining;
    });

    if (newPath) {
      const seq = ++loadSeqRef.current;
      setLoading(true);
      const result = await window.api.readDirectory(newPath);
      if (seq !== loadSeqRef.current) return;
      if (result.success) setFiles(result.files);
      setLoading(false);
      setAnimKey(k => k + 1);
    }
  }, [activeTabId]);

  const getActiveTab = useCallback(() => {
    return tabs.find(t => t.id === activeTabId);
  }, [tabs, activeTabId]);

  const toggleFileSelection = useCallback((filePath: string, multi: boolean) => {
    setSelectedFiles(prev => {
      const next = new Set(multi ? prev : []);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(files.map(f => f.path)));
  }, [files]);

  const clearSelection = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const cutFiles = useCallback(() => {
    if (selectedFiles.size === 0) return;
    setClipboard({ paths: Array.from(selectedFiles), operation: 'cut' });
  }, [selectedFiles]);

  const copyFiles = useCallback(() => {
    if (selectedFiles.size === 0) return;
    setClipboard({ paths: Array.from(selectedFiles), operation: 'copy' });
  }, [selectedFiles]);

  const pasteFiles = useCallback(async () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab || !clipboard) return;

    let failed = 0;
    try {
      if (clipboard.operation === 'copy') {
        const res = await window.api.copyItems(clipboard.paths, tab.path);
        failed = Array.isArray(res) ? res.filter(r => !r.success).length : 0;
      } else {
        const res = await window.api.moveItems(clipboard.paths, tab.path);
        const resList = res?.results as { success: boolean }[] | undefined;
        failed = resList ? resList.filter(r => !r.success).length : 0;
        setClipboard(null);
      }
    } catch (e: any) {
      alert(`Operation failed: ${e?.message || String(e)}`);
      return;
    }

    if (failed > 0) {
      alert(`${failed} item(s) could not be ${clipboard.operation === 'copy' ? 'copied' : 'moved'}.`);
    }

    const result = await window.api.readDirectory(tab.path);
    if (result.success) setFiles(result.files);
  }, [tabs, activeTabId, clipboard]);

  const deleteFiles = useCallback(async () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab || selectedFiles.size === 0) return;

    const results = await window.api.deleteItems(Array.from(selectedFiles));
    const failed = results.filter(r => !r.success).length;
    if (failed > 0) alert(`${failed} item(s) could not be moved to trash.`);
    setSelectedFiles(new Set());

    const result = await window.api.readDirectory(tab.path);
    if (result.success) setFiles(result.files);
  }, [tabs, activeTabId, selectedFiles]);

  const renameFile = useCallback(async (oldPath: string, newName: string) => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    await window.api.rename(oldPath, newName);
    const result = await window.api.readDirectory(tab.path);
    if (result.success) setFiles(result.files);
  }, [tabs, activeTabId]);

  const createNewFolder = useCallback(async (name: string) => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    await window.api.createFolder(tab.path, name);
    const result = await window.api.readDirectory(tab.path);
    if (result.success) setFiles(result.files);
  }, [tabs, activeTabId]);

  const createNewFile = useCallback(async (name: string) => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    await window.api.createFile(tab.path, name);
    const result = await window.api.readDirectory(tab.path);
    if (result.success) setFiles(result.files);
  }, [tabs, activeTabId]);

  const refreshCurrentDir = useCallback(async () => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    setLoading(true);
    const result = await window.api.readDirectory(tab.path);
    if (result.success) setFiles(result.files);
    setLoading(false);
    // Don't increment animKey on refresh — no re-animation
  }, [tabs, activeTabId]);

  const search = useCallback(async (query: string) => {
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    if (searchTimerRef.current) { clearTimeout(searchTimerRef.current); searchTimerRef.current = undefined; }
    const seq = ++searchSeqRef.current;

    if (!query.trim()) {
      setIsSearching(false);
      setSearchResults([]);
      const result = await window.api.readDirectory(tab.path);
      if (seq !== searchSeqRef.current) return;
      if (result.success) setFiles(result.files);
      return;
    }

    // Debounce search by 150ms
    searchTimerRef.current = setTimeout(async () => {
      searchTimerRef.current = undefined;
      setIsSearching(true);
      setLoading(true);
      const results = await window.api.searchFiles(tab.path, query);
      if (seq !== searchSeqRef.current) return;
      setSearchResults(results);
      setLoading(false);
    }, 150);
  }, [tabs, activeTabId]);

  const sortFiles = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField]);

  const sortedFiles = useMemo(() => {
    const source = isSearching ? searchResults : files;
    return [...source].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'modified':
          cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
          break;
        case 'size':
          cmp = a.size - b.size;
          break;
        case 'type':
          const extA = a.name.split('.').pop() || '';
          const extB = b.name.split('.').pop() || '';
          cmp = extA.localeCompare(extB);
          break;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [files, searchResults, isSearching, sortField, sortOrder]);

  return {
    tabs, activeTabId, setActiveTabId,
    files, loading, viewMode, setViewMode,
    sortField, sortOrder, sortFiles,
    clipboard, selectedFiles,
    isSearching, searchResults,
    animKey,
    createTab, navigateTo, loadTabFiles, goBack, goForward, goUp, closeTab, getActiveTab,
    toggleFileSelection, selectAll, clearSelection,
    cutFiles, copyFiles, pasteFiles, deleteFiles,
    renameFile, createNewFolder, createNewFile, refreshCurrentDir,
    search, sortedFiles,
  };
}
