declare global {
  interface Window {
    api: {
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
      getTheme: () => Promise<string>;
      setTheme: (theme: string) => void;
      readDirectory: (dirPath: string) => Promise<{ success: boolean; files: any[]; error?: string }>;
      getHomeDir: () => Promise<string>;
      getInitialPath: () => Promise<string | null>;
      getDrives: () => Promise<{ name: string; path: string; total: number; free: number }[]>;
      createFolder: (dirPath: string, name: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      createFile: (dirPath: string, name: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      setPermissions: (filePath: string, mode: number) => Promise<{ success: boolean; error?: string }>;
      getApplications: () => Promise<{ name: string; exec: string; icon: string | null; desktopFile: string; categories: string }[]>;
      runWithSudo: (command: string) => Promise<{ success: boolean; error?: string }>;
      onDrivesChanged: (callback: () => void) => () => void;
      rename: (oldPath: string, newName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      deleteItems: (paths: string[]) => Promise<{ path: string; success: boolean; error?: string }[]>;
      copyItems: (sources: string[], destination: string) => Promise<any>;
      moveItems: (sources: string[], destination: string) => Promise<any>;
      searchFiles: (dirPath: string, query: string) => Promise<any[]>;
      getFileInfo: (filePath: string) => Promise<any>;
      showItemInFolder: (itemPath: string) => void;
      openItem: (itemPath: string) => void;
      launchApp: (execStr: string) => Promise<{ success: boolean; error?: string }>;
      openInTerminal: (dirPath: string) => Promise<{ success: boolean; error?: string }>;
      setWallpaper: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      getRecentFiles: () => Promise<any[]>;
      getPinnedFolders: () => Promise<{ name: string; path: string; icon: string }[]>;
      getTrashInfo: () => Promise<{ path: string; exists: boolean; count: number; error?: string }>;
      restoreItem: (trashPath: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      emptyTrash: () => Promise<{ success: boolean; error?: string }>;
      onTrashChanged: (callback: () => void) => () => void;
      resolveIcon: (iconName: string) => Promise<string | null>;
      resolveIcons: (items: { path: string; isDir: boolean; name: string }[]) => Promise<Record<string, string | null>>;
      getSpecialIcons: () => Promise<Record<string, string | null>>;
      onCopyProgress: (callback: (data: any) => void) => () => void;
      startDrag: (paths: string[]) => void;
      endDrag: () => void;
      getDragPaths: () => Promise<string[]>;
      getOpenWithApps: (filePath: string) => Promise<{ name: string; exec: string; icon?: string }[]>;
      openWith: (filePath: string, appExec: string) => Promise<{ success: boolean; error?: string }>;
      listArchive: (archivePath: string) => Promise<{ success: boolean; entries: { name: string; size: number; isDir: boolean; compressedSize?: number }[]; error?: string }>;
      extractArchive: (archivePath: string, destDir: string) => Promise<{ success: boolean; error?: string; created?: string[] }>;
      createArchive: (paths: string[], destPath: string) => Promise<{ success: boolean; error?: string }>;
      readThumbnail: (filePath: string) => Promise<{ ok: boolean; data?: string; error?: string }>;
      fetchThumbnailBlob: (filePath: string) => Promise<{ ok: boolean; blob: Blob }>;
    };
  }
}
export {};
