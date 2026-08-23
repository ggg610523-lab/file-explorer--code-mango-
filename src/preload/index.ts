import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (theme: string) => ipcRenderer.send('set-theme', theme),

  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  getInitialPath: () => ipcRenderer.invoke('get-initial-path'),
  getDrives: () => ipcRenderer.invoke('get-drives'),

  createFolder: (dirPath: string, name: string) => ipcRenderer.invoke('create-folder', dirPath, name),
  createFile: (dirPath: string, name: string) => ipcRenderer.invoke('create-file', dirPath, name),
  setPermissions: (filePath: string, mode: number) => ipcRenderer.invoke('set-permissions', filePath, mode),
  getApplications: () => ipcRenderer.invoke('get-applications'),
  runWithSudo: (command: string) => ipcRenderer.invoke('run-with-sudo', command),
  onDrivesChanged: (callback: () => void) => { ipcRenderer.on('drives-changed', () => callback()); return () => { ipcRenderer.removeAllListeners('drives-changed'); }; },
  rename: (oldPath: string, newName: string) => ipcRenderer.invoke('rename', oldPath, newName),
  deleteItems: (paths: string[]) => ipcRenderer.invoke('delete-items', paths),
  copyItems: (sources: string[], dest: string) => ipcRenderer.invoke('copy-items', sources, dest),
  moveItems: (sources: string[], dest: string) => ipcRenderer.invoke('move-items', sources, dest),

  searchFiles: (dirPath: string, query: string) => ipcRenderer.invoke('search-files', dirPath, query),
  getFileInfo: (filePath: string) => ipcRenderer.invoke('get-file-info', filePath),
  showItemInFolder: (itemPath: string) => ipcRenderer.invoke('show-item-in-folder', itemPath),
  openItem: (itemPath: string) => ipcRenderer.invoke('open-item', itemPath),
  launchApp: (execStr: string) => ipcRenderer.invoke('launch-app', execStr),
  openInTerminal: (dirPath: string) => ipcRenderer.invoke('open-in-terminal', dirPath),
  setWallpaper: (filePath: string) => ipcRenderer.invoke('set-wallpaper', filePath),
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  getPinnedFolders: () => ipcRenderer.invoke('get-pinned-folders'),
  getTrashInfo: () => ipcRenderer.invoke('get-trash-info'),
  restoreItem: (trashPath: string) => ipcRenderer.invoke('restore-item', trashPath),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  onTrashChanged: (callback: () => void) => { ipcRenderer.on('trash-changed', () => callback()); return () => { ipcRenderer.removeAllListeners('trash-changed'); }; },

  // Icon APIs
  resolveIcon: (filePath: string, isDir: boolean) => ipcRenderer.invoke('resolve-icon', filePath, isDir),
  resolveIcons: (items: { path: string; isDir: boolean; name: string }[]) => ipcRenderer.invoke('resolve-icons', items),
  getSpecialIcons: () => ipcRenderer.invoke('get-special-icons'),

  // Progress events
  onCopyProgress: (callback: (data: any) => void) => {
    const handler = (_e: any, data: any) => callback(data);
    ipcRenderer.on('copy-progress', handler);
    return () => ipcRenderer.removeListener('copy-progress', handler);
  },

  // Drag state (cross-window)
  startDrag: (paths: string[]) => ipcRenderer.send('drag-start', paths),
  endDrag: () => ipcRenderer.send('drag-end'),
  getDragPaths: () => ipcRenderer.invoke('get-drag-paths'),

  // Open With
  getOpenWithApps: (filePath: string) => ipcRenderer.invoke('get-open-with-apps', filePath),
  openWith: (filePath: string, appExec: string) => ipcRenderer.invoke('open-with', filePath, appExec),

  // Archives
  listArchive: (archivePath: string) => ipcRenderer.invoke('list-archive', archivePath),
  extractArchive: (archivePath: string, destDir: string) => ipcRenderer.invoke('extract-archive', archivePath, destDir),
  createArchive: (paths: string[], destPath: string) => ipcRenderer.invoke('create-archive', paths, destPath),
});
