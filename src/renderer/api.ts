// Tauri-backed implementation of the `window.api` bridge.
//
// The original app was built on Electron: the renderer talks to a main process
// through `window.api.*` exposed by a preload script. Tauri replaces that main
// process with Rust commands, so we re-implement the same surface on top of
// Tauri's IPC (`invoke` + `listen`). The React components are otherwise
// unchanged.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

function base64ToBlob(b64: string, type = 'application/octet-stream'): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

const api: typeof window.api = {
  // Window controls
  windowMinimize: () => void invoke('window_minimize'),
  windowMaximize: () => void invoke('window_maximize'),
  windowClose: () => void invoke('window_close'),

  // Theme
  getTheme: () => invoke('get_theme'),
  setTheme: (theme: string) => void invoke('set_theme', { theme }),

  // File system
  readDirectory: (dirPath) => invoke('read_directory', { dirPath }),
  getHomeDir: () => invoke('get_home_dir'),
  getInitialPath: () => invoke('get_initial_path'),
  getDrives: () => invoke('get_drives'),

  createFolder: (dirPath, name) => invoke('create_folder', { dirPath, name }),
  createFile: (dirPath, name) => invoke('create_file', { dirPath, name }),
  setPermissions: (filePath, mode) => invoke('set_permissions', { filePath, mode }),
  getApplications: () => invoke('get_applications'),
  runWithSudo: (command) => invoke('run_with_sudo', { command }),

  rename: (oldPath, newName) => invoke('rename', { oldPath, newName }),
  deleteItems: (paths) => invoke('delete_items', { paths }),
  copyItems: (sources, destination) => invoke('copy_items', { sources, destination }),
  moveItems: (sources, destination) => invoke('move_items', { sources, destination }),

  searchFiles: (dirPath, query) => invoke('search_files', { dirPath, query }),
  getFileInfo: (filePath) => invoke('get_file_info', { filePath }),
  showItemInFolder: (itemPath) => void invoke('show_item_in_folder', { itemPath }),
  openItem: (itemPath) => void invoke('open_item', { itemPath }),
  launchApp: (execStr) => invoke('launch_app', { execStr }),
  openInTerminal: (dirPath) => invoke('open_in_terminal', { dirPath }),
  setWallpaper: (filePath) => invoke('set_wallpaper', { filePath }),

  getRecentFiles: () => invoke('get_recent_files'),
  getPinnedFolders: () => invoke('get_pinned_folders'),
  getTrashInfo: () => invoke('get_trash_info'),
  restoreItem: (trashPath) => invoke('restore_item', { trashPath }),
  emptyTrash: () => invoke('empty_trash'),

  // Icons
  resolveIcon: (iconName) => invoke('resolve_icon', { iconName }),
  resolveIcons: (items) => invoke('resolve_icons', { items }),
  getSpecialIcons: () => invoke('get_special_icons'),

  // Thumbnails (replaces the Electron `thumbnails://` protocol)
  readThumbnail: (filePath) => invoke('read_thumbnail', { filePath }),

  // Events
  onDrivesChanged: (callback) => {
    const unsub = listen('drives-changed', () => callback());
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      unsub.then((f) => f());
    };
  },
  onTrashChanged: (callback) => {
    const unsub = listen('trash-changed', () => callback());
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      unsub.then((f) => f());
    };
  },
  onCopyProgress: (callback) => {
    const unsub = listen('copy-progress', (e) => callback(e.payload));
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      unsub.then((f) => f());
    };
  },

  // Drag state
  startDrag: (paths) => void invoke('drag_start', { paths }),
  endDrag: () => void invoke('drag_end'),
  getDragPaths: () => invoke('get_drag_paths'),

  // Open With
  getOpenWithApps: (filePath) => invoke('get_open_with_apps', { filePath }),
  openWith: (filePath, appExec) => invoke('open_with', { filePath, appExec }),

  // Archives
  listArchive: (archivePath) => invoke('list_archive', { archivePath }),
  extractArchive: (archivePath, destDir) => invoke('extract_archive', { archivePath, destDir }),
  createArchive: (paths, destPath) => invoke('create_archive', { paths, destPath }),

  // Thumbnail helpers used by the worker / previews
  fetchThumbnailBlob: async (filePath: string): Promise<{ ok: boolean; blob: Blob }> => {
    const res = await invoke('read_thumbnail', { filePath });
    if (res && (res as any).ok && (res as any).data) {
      return { ok: true, blob: base64ToBlob((res as any).data) };
    }
    return { ok: false, blob: new Blob() };
  },
};

window.api = api;