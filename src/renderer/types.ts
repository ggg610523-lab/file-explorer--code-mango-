export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modified: string;
  created: string;
  permissions: string;
  parentDir?: string;
  icon?: string | null;
}

export interface Tab {
  id: string;
  path: string;
  title: string;
  history: string[];
  historyIndex: number;
}

export type ViewMode = 'grid-sm' | 'grid-md' | 'grid-lg' | 'details' | 'list';
export type SortField = 'name' | 'modified' | 'size' | 'type';
export type SortOrder = 'asc' | 'desc';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface ClipboardData {
  paths: string[];
  operation: 'copy' | 'cut';
}

export interface DriveInfo {
  name: string;
  path: string;
  total: number;
  free: number;
}
