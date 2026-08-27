import { app, BrowserWindow, ipcMain, shell, nativeTheme, protocol, net, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';

// Non-blocking child-process helper: never stalls the main process / UI frames.
function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// ── Register custom protocol scheme (must be before app ready) ───────────────
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumbnails', privileges: { bypassCSP: true, corsEnabled: true, supportFetchAPI: true, stream: true } },
]);

// ── Chromium speed flags (must run before app ready) ────────────────────────
app.commandLine.appendSwitch('enable-features', 'BackForwardCache,ParallelDownloading,CompositeAfterPaint,ThreadedCompositing,UseSkiaRenderer,CanvasOopRasterization,ThrottleDisplayNoneAndVisibilityHiddenCrossOriginIframes');
app.commandLine.appendSwitch('disable-features', 'TranslateUI,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('num-raster-threads', '4');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('v8-cache-options', 'code');
app.commandLine.appendSwitch('max_old_space_size', '4096');
app.commandLine.appendSwitch('js-flags', '--max-semi-space-size=64 --optimize-for-size');
app.commandLine.appendSwitch('enable-gpu-compositing');
app.commandLine.appendSwitch('enable-oop-rasterization');
app.commandLine.appendSwitch('use-gl', 'angle');

let mainWindow: BrowserWindow | null = null;

// ── Initial launch path (from CLI args / xdg-open) ──────────────────────────
let initialPath: string | null = null;
function parseInitialPath(): string | null {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('file://')) {
      try { return decodeURIComponent(new URL(arg).pathname); } catch {}
    }
    if (arg.startsWith('/') && fs.existsSync(arg)) return arg;
  }
  return null;
}

// ── .desktop file parsing ────────────────────────────────────────────────────
function parseDesktopEntry(content: string) {
  const result = { name: '', exec: '', icon: '', mimeType: '', categories: '', noDisplay: false };
  let inEntry = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inEntry = line === '[Desktop Entry]';
      continue;
    }
    if (!inEntry) continue;
    if (line.startsWith('Name=') && !result.name) result.name = line.slice(5).trim();
    else if (line.startsWith('Exec=') && !result.exec) result.exec = line.slice(5).trim();
    else if (line.startsWith('Icon=') && !result.icon) result.icon = line.slice(5).trim();
    else if (line.startsWith('MimeType=') && !result.mimeType) result.mimeType = line.slice(9).trim();
    else if (line.startsWith('Categories=') && !result.categories) result.categories = line.slice(11).trim();
    else if (line.startsWith('NoDisplay=')) result.noDisplay = line.slice(10).trim() === 'true';
  }
  result.exec = result.exec.replace(/%[fFuUdDnNickvm]/g, '').trim();
  return result;
}

function execToArgs(exec: string, filePath: string): string[] {
  const substituted = exec.replace(/%[fFuUdDnNickvm]/g, (m) => (
    m === '%f' || m === '%F' || m === '%u' || m === '%U' ? filePath : ''
  ));
  const args: string[] = [];
  let cur = '', inQuotes = false, escaped = false;
  for (const ch of substituted) {
    if (escaped) { cur += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ' ' && !inQuotes) { if (cur) { args.push(cur); cur = ''; } continue; }
    cur += ch;
  }
  if (cur) args.push(cur);
  return args;
}

// ── Drag state (cross-window) ────────────────────────────────────────────────
let dragState: { paths: string[]; sourceWindowId: number } | null = null;

// ── Icon Theme (Reversal) ───────────────────────────────────────────────────
const reversalDir = path.join(__dirname, '../renderer/reversal-icons');
const fallbackDirs = [
  '/usr/share/icons/Adwaita',
  '/usr/share/icons/Pop',
  '/usr/share/icons/hicolor',
];
// Legacy icon-theme layout: <theme>/<category>/<size>  (used by reversal-icons)
const legacyCategories = ['places', 'mimes', 'devices', 'apps', 'actions', 'categories', 'status', 'emblems'];
// Modern layout: <theme>/<size>/<category>  (used by Adwaita, Pop, hicolor…)
const modernCategories = ['places', 'mimetypes', 'devices', 'apps', 'actions', 'categories', 'status', 'emblems', 'stock'];
const iconIndex = new Map<string, string>();
let iconCachePath = '';
let iconIndexLoadedFromCache = false;

function scanIconDir(dir: string): void {
  const sizes = ['scalable', '48x48', '48', '32', '22'];
  for (const cat of legacyCategories) {
    for (const size of sizes) {
      const dirPath = path.join(dir, cat, size);
      try {
        for (const file of fs.readdirSync(dirPath)) {
          const ext = path.extname(file);
          if (ext !== '.svg' && ext !== '.png') continue;
          const name = path.basename(file, ext);
          if (!iconIndex.has(name)) iconIndex.set(name, path.join(dirPath, file));
        }
      } catch {}
    }
  }
}

// Chunked, non-blocking scan of a modern-layout theme (<theme>/<size>/<category>).
async function scanThemeAsync(dir: string): Promise<void> {
  let sizes: string[] = [];
  try { sizes = fs.readdirSync(dir); } catch { return; }
  for (const size of sizes) {
    if (size.startsWith('.')) continue;
    const sizeDir = path.join(dir, size);
    let cats: string[] = [];
    try { cats = fs.readdirSync(sizeDir); } catch { continue; }
    for (const cat of cats) {
      if (!modernCategories.includes(cat)) continue;
      const catDir = path.join(sizeDir, cat);
      let files: string[] = [];
      try { files = fs.readdirSync(catDir); } catch { continue; }
      for (const file of files) {
        const ext = path.extname(file);
        if (ext !== '.svg' && ext !== '.png') continue;
        const name = path.basename(file, ext);
        if (!iconIndex.has(name)) iconIndex.set(name, path.join(catDir, file));
      }
    }
    // Yield so the main process stays responsive during the first-run scan.
    await new Promise<void>(res => setImmediate(res));
  }
}

function initIcons(): void {
  iconCachePath = path.join(app.getPath('userData'), 'icon-cache.json');
  try {
    const data = JSON.parse(fs.readFileSync(iconCachePath, 'utf-8'));
    for (const [k, v] of Object.entries(data)) iconIndex.set(k, v as string);
    iconIndexLoadedFromCache = true;
  } catch { scanIconDir(reversalDir); }
  console.log(`[icons] loaded ${iconIndex.size} icons`);
}

async function buildFullIndexAsync(): Promise<void> {
  // Cache is authoritative when it loaded successfully — skip the per-launch rescan
  // and the synchronous ~0.5MB JSON rewrite that used to block startup.
  if (iconIndexLoadedFromCache) return;
  try {
    for (const dir of fallbackDirs) {
      if (!fs.existsSync(dir)) continue;
      await scanThemeAsync(dir);
    }
    console.log(`[icons] full index: ${iconIndex.size} icons`);
    const obj: Record<string, string> = {};
    iconIndex.forEach((v, k) => { obj[k] = v; });
    await fs.promises.writeFile(iconCachePath, JSON.stringify(obj));
    iconIndexLoadedFromCache = true;
  } catch (error: any) {
    console.warn('[icons] index build failed', error?.message);
  }
}

initialPath = parseInitialPath();

function resolveIcon(iconName: string): string | null {
  return iconIndex.get(iconName) || null;
}

// ── MIME → Icon mapping ──────────────────────────────────────────────────────
const mimeToIcon: Record<string, string> = {
  'inode/directory': 'folder',
  'inode/symlink': 'inode-symlink',
  'text/plain': 'text-x-generic',
  'text/html': 'text-html',
  'text/x-python': 'text-x-script',
  'text/x-script': 'text-x-script',
  'text/x-c': 'text-x-script',
  'text/x-c++src': 'text-x-script',
  'text/x-java': 'text-x-script',
  'text/x-shellscript': 'text-x-script',
  'text/x-markdown': 'text-x-generic',
  'text/x-log': 'text-x-generic',
  'text/x-diff': 'text-x-generic',
  'text/css': 'text-x-generic',
  'text/csv': 'x-office-spreadsheet',
  'text/xml': 'text-x-generic',
  'application/json': 'text-x-generic',
  'application/javascript': 'text-x-script',
  'application/xml': 'text-x-generic',
  'application/x-shellscript': 'text-x-script',
  'application/x-executable': 'application-x-executable',
  'application/x-sharedlib': 'application-x-sharedlib',
  'application/x-appimage': 'application-x-executable',
  'application/x-deb': 'package-x-generic',
  'application/x-rpm': 'package-x-generic',
  'application/x-archive': 'package-x-generic',
  'application/x-7z-compressed': 'package-x-generic',
  'application/x-rar': 'package-x-generic',
  'application/zip': 'application-zip',
  'application/gzip': 'application-x-tar',
  'application/x-tar': 'application-x-tar',
  'application/x-bzip2': 'application-x-tar',
  'application/x-xz': 'application-x-tar',
  'application/pdf': 'application-pdf',
  'application/msword': 'x-office-document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'x-office-document',
  'application/vnd.ms-excel': 'x-office-spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'x-office-spreadsheet',
  'application/vnd.ms-powerpoint': 'x-office-presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'x-office-presentation',
  'image/png': 'image-x-generic',
  'image/jpeg': 'image-x-generic',
  'image/gif': 'image-x-generic',
  'image/svg+xml': 'image-x-generic',
  'image/webp': 'image-x-generic',
  'image/bmp': 'image-x-generic',
  'image/tiff': 'image-x-generic',
  'image/x-icon': 'image-x-generic',
  'video/mp4': 'video-x-generic',
  'video/x-matroska': 'video-x-generic',
  'video/webm': 'video-x-generic',
  'video/x-msvideo': 'video-x-generic',
  'video/quicktime': 'video-x-generic',
  'audio/mpeg': 'audio-x-generic',
  'audio/x-flac': 'audio-x-generic',
  'audio/ogg': 'audio-x-generic',
  'audio/x-wav': 'audio-x-generic',
  'audio/mp4': 'audio-x-generic',
  'audio/x-aac': 'audio-x-generic',
  'audio/x-ms-wma': 'audio-x-generic',
  'font/ttf': 'font-x-generic',
  'font/otf': 'font-x-generic',
  'application/x-font-ttf': 'font-x-generic',
  'application/font-sfnt': 'font-x-generic',
  'application-x-generic': 'application-x-generic',
};

const extToMime: Record<string, string> = {
  '.txt': 'text/plain', '.md': 'text/plain', '.log': 'text/plain',
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.ts': 'text/x-script',
  '.tsx': 'text/x-script', '.jsx': 'text/x-script',
  '.py': 'text/x-python', '.rb': 'text/x-script',
  '.java': 'text/x-java', '.c': 'text/x-c', '.cpp': 'text/x-c++src',
  '.h': 'text/x-c', '.hpp': 'text/x-c++src', '.rs': 'text/x-script',
  '.go': 'text/x-script', '.php': 'text/x-script', '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript', '.zsh': 'text/x-shellscript',
  '.csv': 'text/csv', '.xml': 'text/xml', '.json': 'application/json',
  '.yaml': 'text/plain', '.yml': 'text/plain', '.toml': 'text/plain',
  '.ini': 'text/plain', '.conf': 'text/plain', '.cfg': 'text/plain',
  '.diff': 'text/x-diff', '.patch': 'text/x-diff',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'x-office-document', '.ods': 'x-office-spreadsheet', '.odp': 'x-office-presentation',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.ico': 'image/x-icon', '.heic': 'image/jpeg', '.heif': 'image/jpeg',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.flv': 'video/x-msvideo',
  '.wmv': 'video/x-msvideo', '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg', '.flac': 'audio/x-flac', '.ogg': 'audio/ogg',
  '.wav': 'audio/x-wav', '.m4a': 'audio/mp4', '.aac': 'audio/x-aac',
  '.wma': 'audio/x-ms-wma',
  '.zip': 'application/zip', '.tar': 'application/x-tar', '.gz': 'application/gzip',
  '.bz2': 'application/x-bzip2', '.xz': 'application/x-xz',
  '.7z': 'application/x-7z-compressed', '.rar': 'application/x-rar',
  '.deb': 'application/x-deb', '.rpm': 'application/x-rpm',
  '.AppImage': 'application/x-appimage', '.flatpak': 'application/x-archive',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/ttf', '.woff2': 'font/ttf',
  '.exe': 'application/x-executable', '.dll': 'application/x-sharedlib',
  '.so': 'application/x-sharedlib', '.bin': 'application/x-executable',
  '.lock': 'text/plain', '.env': 'text/plain',
  '.db': 'application-x-generic', '.sqlite': 'application-x-generic',
};

// ── Special folder icons (Reversal names) ────────────────────────────────────
const specialFolderIcons: Record<string, string> = {
  'home': 'user-home',
  'desktop': 'user-desktop',
  'documents': 'folder-documents',
  'downloads': 'folder-download',
  'pictures': 'folder-images',
  'music': 'folder-music',
  'videos': 'folder-videos',
  'trash': 'user-trash',
  'folder': 'folder',
  'web': 'web-browser',
};

// Folder name → icon name lookup (case-insensitive)
const folderNameMap = new Map<string, string>();
for (const [key, icon] of Object.entries(specialFolderIcons)) {
  folderNameMap.set(key.toLowerCase(), icon);
}

function getFolderIcon(name: string): string {
  const icon = folderNameMap.get(name.toLowerCase());
  if (icon) return icon;
  // Try common aliases
  const lower = name.toLowerCase();
  if (lower === 'templates') return 'folder-templates';
  if (lower === 'public') return 'folder-public';
  if (lower === 'projects') return 'folder-projects';
  if (lower === 'downloads') return 'folder-download';
  if (lower === 'tmp' || lower === 'temp') return 'folder-temp';
  return 'folder';
}

function getIconForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  // Extension lookup
  const mime = extToMime[ext];
  if (mime) {
    const icon = mimeToIcon[mime];
    if (icon) return icon;
  }

  return 'text-x-generic';
}

// Memoize `file --mime-type` probes per extension so a directory of unknown
// files resolves icons with one process instead of one per file.
const mimeProbeCache = new Map<string, string>();

// Async variant used off the hot path: probes the real MIME type without blocking.
async function getIconForFileAsync(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  // Extension lookup
  const mime = extToMime[ext];
  if (mime) {
    const icon = mimeToIcon[mime];
    if (icon) return icon;
  }

  const cached = mimeProbeCache.get(ext);
  if (cached) return cached;

  // Fallback: try `file --mime-type` (async — no main-thread stall)
  try {
    const result = (await run('file', ['--mime-type', '-b', filePath], 2000)).trim();
    const icon = mimeToIcon[result];
    if (icon) {
      if (mimeProbeCache.size > 512) mimeProbeCache.clear();
      mimeProbeCache.set(ext, icon);
      return icon;
    }
  } catch {}

  return 'text-x-generic';
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow(): void {
  initIcons();

  protocol.handle('thumbnails', (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    if (!filePath) return new Response('Not Found', { status: 404 });
    return net.fetch(`file://${filePath}`, { bypassCustomProtocolHandlers: true });
  });
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: false,
    backgroundColor: '#fafbfd',
    roundedCorners: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      v8CacheOptions: 'code',
      enableBlinkFeatures: 'CSSBackdropFilter,CSSColorScheme,CSSContentVisibility,CSSPropertyAPI',
    },
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.webContents.setFrameRate(120);
    mainWindow?.show();
    buildFullIndexAsync();
    if (mainWindow) startDriveWatcher(mainWindow);
  });
  mainWindow.on('closed', () => { stopDriveWatcher(); mainWindow = null; });
}

app.whenReady().then(() => {
  // Frameless window: drop the auto-generated menu (saves startup/main-thread overhead).
  Menu.setApplicationMenu(null);
  createWindow();
});
app.on('window-all-closed', () => { stopDriveWatcher(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC: Window controls ─────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ── IPC: Theme ───────────────────────────────────────────────────────────────
ipcMain.handle('get-initial-path', () => initialPath);
ipcMain.handle('get-theme', () => nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
ipcMain.on('set-theme', (_e, theme: string) => {
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light';
});

// ── IPC: Icons ───────────────────────────────────────────────────────────────
ipcMain.handle('resolve-icon', async (_e, filePath: string, isDir: boolean) => {
  if (isDir) {
    const name = path.basename(filePath);
    return resolveIcon(getFolderIcon(name));
  }
  return resolveIcon(await getIconForFileAsync(filePath));
});

ipcMain.handle('resolve-icons', async (_e, items: { path: string; isDir: boolean; name: string }[]) => {
  const result: Record<string, string | null> = {};
  const resolveOne = async (item: { path: string; isDir: boolean; name: string }) => {
    if (item.isDir) {
      result[item.path] = resolveIcon(getFolderIcon(item.name));
    } else {
      result[item.path] = resolveIcon(await getIconForFileAsync(item.path));
    }
  };
  // Cap concurrent `file` probes to keep main smooth while resolving batches.
  const CONCURRENCY = 8;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(resolveOne));
  }
  return result;
});

ipcMain.handle('get-special-icons', () => {
  const icons: Record<string, string | null> = {};
  for (const [key, iconName] of Object.entries(specialFolderIcons)) {
    icons[key] = resolveIcon(iconName);
  }
  icons['drive'] = resolveIcon('drive-harddisk') || resolveIcon('drive');
  icons['network'] = resolveIcon('network-server') || resolveIcon('network-workgroup');
  return icons;
});

// ── IPC: File system ─────────────────────────────────────────────────────────
ipcMain.handle('get-home-dir', () => os.homedir());

ipcMain.handle('read-directory', async (_e, dirPath: string) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const raw = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dirPath, entry.name);
        try {
          const stats = await fs.promises.stat(fullPath);
          return {
            name: entry.name, path: fullPath,
            isDirectory: entry.isDirectory(), isFile: entry.isFile(),
            isSymlink: entry.isSymbolicLink(), size: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
            permissions: (stats.mode & 0o777).toString(8),
          };
        } catch {
          return {
            name: entry.name, path: fullPath,
            isDirectory: entry.isDirectory(), isFile: entry.isFile(),
            isSymlink: entry.isSymbolicLink(), size: 0,
            modified: '', created: '', permissions: '',
          };
        }
      })
    );
    // Batch-resolve icons in main process
    const files = raw.map(f => ({
      ...f,
      icon: f.isDirectory ? resolveIcon(getFolderIcon(f.name)) : resolveIcon(getIconForFile(f.path)),
    }));
    return { success: true, files };
  } catch (error: any) {
    return { success: false, error: error.message, files: [] };
  }
});

ipcMain.handle('get-drives', async () => {
  try {
    const mounts = await fs.promises.readFile('/proc/mounts', 'utf-8');
    const seen = new Set<string>();
    const drives: { name: string; path: string; total: number; free: number }[] = [];
    for (const line of mounts.split('\n')) {
      const parts = line.split(' ');
      const mp = parts[1];
      if (!mp || seen.has(mp)) continue;
      if (mp === '/' || mp.startsWith('/media') || mp.startsWith('/mnt') || mp.startsWith('/run/media')) {
        seen.add(mp);
        try {
          const st = await fs.promises.statfs(mp);
          drives.push({
            name: mp === '/' ? 'Root' : path.basename(mp) || mp,
            path: mp, total: st.blocks * st.bsize, free: st.bfree * st.bsize,
          });
        } catch {
          drives.push({
            name: mp === '/' ? 'Root' : path.basename(mp) || mp,
            path: mp, total: 0, free: 0,
          });
        }
      }
    }
    return drives;
  } catch {
    return [{ name: 'Root', path: '/', total: 0, free: 0 }];
  }
});

ipcMain.handle('create-folder', async (_e, dirPath: string, name: string) => {
  try {
    const newPath = path.join(dirPath, name);
    await fs.promises.mkdir(newPath, { recursive: true });
    return { success: true, path: newPath };
  } catch (error: any) { return { success: false, error: error.message }; }
});

ipcMain.handle('create-file', async (_e, dirPath: string, name: string) => {
  try {
    const newPath = path.join(dirPath, name);
    await fs.promises.writeFile(newPath, '', 'utf-8');
    return { success: true, path: newPath };
  } catch (error: any) { return { success: false, error: error.message }; }
});

ipcMain.handle('set-permissions', async (_e, filePath: string, mode: number) => {
  try {
    await fs.promises.chmod(filePath, mode);
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
});

ipcMain.handle('run-with-sudo', async (_e, command: string) => {
  try {
    const { spawn } = require('child_process');
    const terminals = [
      { cmd: 'konsole', args: ['--hold', '-e', `pkexec bash -c '${command.replace(/'/g, "'\\''")}'`] },
      { cmd: 'gnome-terminal', args: ['--', 'pkexec', 'bash', '-c', command] },
      { cmd: 'alacritty', args: ['-e', 'pkexec', 'bash', '-c', command] },
      { cmd: 'kitty', args: ['-e', 'pkexec', 'bash', '-c', command] },
      { cmd: 'foot', args: [] },
      { cmd: 'xterm', args: ['-e', 'pkexec', 'bash', '-c', command] },
    ];
    for (const t of terminals) {
      try {
        await run('which', [t.cmd], 2000);
        if (t.cmd) {
          spawn(t.cmd, t.args, { detached: true, stdio: 'ignore' }).unref();
          return { success: true };
        }
      } catch {}
    }
    return { success: false, error: 'No terminal emulator found' };
  } catch (error: any) { return { success: false, error: error.message }; }
});

// ── IPC: Installed Applications ──────────────────────────────────────────────
ipcMain.handle('get-applications', async () => {
  const apps: { name: string; exec: string; icon: string | null; desktopFile: string; categories: string }[] = [];
  const seen = new Set<string>();

  const desktopDirs = [
    '/usr/share/applications',
    path.join(os.homedir(), '.local/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications',
  ];

  for (const dir of desktopDirs) {
    try {
      const entries = await fs.promises.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.desktop') || entry === 'defaults.list') continue;
        if (seen.has(entry)) continue;
        seen.add(entry);

        try {
          const content = await fs.promises.readFile(path.join(dir, entry), 'utf-8');
          const d = parseDesktopEntry(content);

          if (!d.name || !d.exec || d.noDisplay) continue;

          // Resolve icon path
          let iconPath: string | null = null;
          if (d.icon) {
            if (d.icon.startsWith('/')) {
              iconPath = d.icon;
            } else {
              // Look up in icon theme
              iconPath = resolveIcon(d.icon);
            }
          }

          apps.push({ name: d.name, exec: d.exec, icon: iconPath, desktopFile: entry, categories: d.categories });
        } catch {}
      }
    } catch {}
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
});

ipcMain.handle('rename', async (_e, oldPath: string, newName: string) => {
  try {
    const newPath = path.join(path.dirname(oldPath), newName);
    await fs.promises.rename(oldPath, newPath);
    return { success: true, path: newPath };
  } catch (error: any) { return { success: false, error: error.message }; }
});

// ── Trash (Freedesktop-style) helpers ────────────────────────────────────────
function trashDirs() {
  const root = path.join(os.homedir(), '.local/share/Trash');
  return { root, files: path.join(root, 'files'), info: path.join(root, 'info') };
}

async function ensureTrash() {
  const t = trashDirs();
  await fs.promises.mkdir(t.files, { recursive: true });
  await fs.promises.mkdir(t.info, { recursive: true });
  return t;
}

function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 1;
  while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
  return `${base} (${i})${ext}`;
}

async function moveToTrash(source: string): Promise<void> {
  const t = await ensureTrash();
  const name = uniqueName(t.files, path.basename(source));
  const dest = path.join(t.files, name);
  await fs.promises.rename(source, dest);
  const info = [
    '[Trash Info]',
    `Path=${encodeURIComponent(source)}`,
    `DeletionDate=${new Date().toISOString()}`,
  ].join('\n') + '\n';
  await fs.promises.writeFile(path.join(t.info, `${name}.trashinfo`), info);
}

function broadcastTrashChanged() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('trash-changed');
}

ipcMain.handle('delete-items', async (_e, paths: string[]) => {
  const results: { path: string; success: boolean; error?: string }[] = [];
  const t = trashDirs();
  let anyTrashed = false;
  for (const p of paths) {
    try {
      if (path.dirname(p) === t.files) {
        await fs.promises.rm(p, { recursive: true, force: true });
      } else {
        await moveToTrash(p);
      }
      anyTrashed = true;
      results.push({ path: p, success: true });
    } catch (error: any) { results.push({ path: p, success: false, error: error.message }); }
  }
  if (anyTrashed) broadcastTrashChanged();
  return results;
});

ipcMain.handle('restore-item', async (_e, trashPath: string) => {
  const t = trashDirs();
  const name = path.basename(trashPath);
  let original = '';
  try {
    const content = await fs.promises.readFile(path.join(t.info, `${name}.trashinfo`), 'utf-8');
    const m = content.match(/^Path=(.+)$/m);
    if (m) original = decodeURIComponent(m[1]);
  } catch {}
  if (!original || !path.isAbsolute(original)) original = path.join(os.homedir(), name);
  const parentDir = path.dirname(original);
  const target = path.join(parentDir, uniqueName(parentDir, path.basename(original)));
  try {
    await fs.promises.rename(trashPath, target);
    await fs.promises.unlink(path.join(t.info, `${name}.trashinfo`)).catch(() => {});
    broadcastTrashChanged();
    return { success: true, path: target };
  } catch (error: any) { return { success: false, error: error.message }; }
});

ipcMain.handle('empty-trash', async () => {
  const t = trashDirs();
  try {
    const [files, infos] = await Promise.all([
      fs.promises.readdir(t.files).catch(() => [] as string[]),
      fs.promises.readdir(t.info).catch(() => [] as string[]),
    ]);
    await Promise.all(files.map(f => fs.promises.rm(path.join(t.files, f), { recursive: true, force: true })));
    await Promise.all(infos.map(f => fs.promises.rm(path.join(t.info, f), { recursive: true, force: true })));
    broadcastTrashChanged();
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
});

// ── File counting for progress ────────────────────────────────────────────────
async function countFilesRecursive(dirPath: string): Promise<{ files: number; bytes: number }> {
  let files = 0, bytes = 0;
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const sub = await countFilesRecursive(full);
        files += sub.files;
        bytes += sub.bytes;
      } else {
        files++;
        try { bytes += (await fs.promises.stat(full)).size; } catch {}
      }
    }
  } catch {}
  return { files, bytes };
}

// Batches 'copy-progress' IPC so copying thousands of files doesn't flood
// the renderer with a message per file (the main smoothness win for bulk ops).
function createProgressEmitter(wc: Electron.WebContents, intervalMs = 80) {
  let timer: NodeJS.Timeout | null = null;
  let pending: unknown = null;
  const sendNow = () => {
    if (pending !== null) {
      wc.send('copy-progress', pending);
      pending = null;
    }
  };
  return {
    send(data: unknown) {
      pending = data;
      if (!timer) timer = setInterval(sendNow, intervalMs);
    },
    flush() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      sendNow();
    },
    finish(data?: unknown) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (data !== undefined) pending = data;
      sendNow();
    },
  };
}

async function copyDirRecursiveProgress(
  src: string, dest: string,
  onFile: (name: string, srcPath: string) => void,
  state: { filesDone: number; bytesDone: number; totalFiles: number; totalBytes: number; operation: string },
): Promise<void> {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursiveProgress(s, d, onFile, state);
    } else {
      try {
        const stats = await fs.promises.stat(s);
        await fs.promises.copyFile(s, d);
        state.filesDone++;
        state.bytesDone += stats.size;
      } catch {}
      onFile(entry.name, s);
    }
  }
}

ipcMain.handle('copy-items', async (e, sources: string[], destination: string) => {
  const wc = e.sender;
  const results: { source: string; dest: string; success: boolean; error?: string }[] = [];

  // Count total files/bytes
  let totalFiles = 0, totalBytes = 0;
  for (const src of sources) {
    try {
      const stats = await fs.promises.stat(src);
      if (stats.isDirectory()) {
        const c = await countFilesRecursive(src);
        totalFiles += c.files;
        totalBytes += c.bytes;
      } else {
        totalFiles++;
        totalBytes += stats.size;
      }
    } catch {}
  }

  const state = { filesDone: 0, bytesDone: 0, totalFiles, totalBytes, operation: 'copy' };
  const emitter = createProgressEmitter(wc);
  emitter.send({ type: 'start', totalFiles, totalBytes, operation: 'copy', sources: sources.map(s => path.basename(s)) });

  const sendProgress = (name: string, srcPath: string) => {
    emitter.send({
      type: 'progress',
      currentFile: name,
      currentPath: srcPath,
      filesDone: state.filesDone,
      totalFiles: state.totalFiles,
      bytesDone: state.bytesDone,
      totalBytes: state.totalBytes,
      operation: 'copy',
    });
  };

  for (const source of sources) {
    const destPath = path.join(destination, path.basename(source));
    try {
      const stats = await fs.promises.stat(source);
      if (stats.isDirectory()) {
        await copyDirRecursiveProgress(source, destPath, sendProgress, state);
      } else {
        await fs.promises.copyFile(source, destPath);
        state.filesDone++;
        state.bytesDone += stats.size;
        sendProgress(path.basename(source), source);
      }
      results.push({ source, dest: destPath, success: true });
    } catch (error: any) { results.push({ source, dest: destPath, success: false, error: error.message }); }
  }

  emitter.finish({ type: 'complete' });
  return results;
});

// Strict recursive copy that throws on any failure (used for cross-device moves).
async function copyRecursiveStrict(src: string, dest: string): Promise<{ files: number; bytes: number }> {
  const stats = await fs.promises.stat(src);
  if (stats.isDirectory()) {
    await fs.promises.mkdir(dest, { recursive: true });
    let files = 0, bytes = 0;
    const entries = await fs.promises.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const sub = await copyRecursiveStrict(path.join(src, entry.name), path.join(dest, entry.name));
      files += sub.files;
      bytes += sub.bytes;
    }
    return { files, bytes };
  }
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  await fs.promises.copyFile(src, dest);
  return { files: 1, bytes: stats.size };
}

ipcMain.handle('move-items', async (e, sources: string[], destination: string) => {
  const wc = e.sender;
  const results: { source: string; dest: string; success: boolean; error?: string }[] = [];

  let totalFiles = 0, totalBytes = 0;
  for (const src of sources) {
    try {
      const stats = await fs.promises.stat(src);
      if (stats.isDirectory()) {
        const c = await countFilesRecursive(src);
        totalFiles += c.files;
        totalBytes += c.bytes;
      } else {
        totalFiles++;
        totalBytes += stats.size;
      }
    } catch {}
  }

  const state = { filesDone: 0, bytesDone: 0, totalFiles, totalBytes, operation: 'move' };
  const emitter = createProgressEmitter(wc);
  emitter.send({ type: 'start', totalFiles, totalBytes, operation: 'move', sources: sources.map(s => path.basename(s)) });

  for (const source of sources) {
    const destPath = path.join(destination, path.basename(source));
    try {
      try {
        await fs.promises.rename(source, destPath);
      } catch (err: any) {
        if (err && err.code === 'EXDEV') {
          await copyRecursiveStrict(source, destPath);
          await fs.promises.rm(source, { recursive: true, force: true });
        } else {
          throw err;
        }
      }
      const stats = await fs.promises.stat(destPath).catch(() => null);
      state.filesDone++;
      if (stats) state.bytesDone += stats.size;
      emitter.send({
        type: 'progress',
        currentFile: path.basename(source),
        currentPath: source,
        filesDone: state.filesDone,
        totalFiles: state.totalFiles,
        bytesDone: state.bytesDone,
        totalBytes: state.totalBytes,
        operation: 'move',
      });
      results.push({ source, dest: destPath, success: true });
    } catch (error: any) { results.push({ source, dest: destPath, success: false, error: error.message }); }
  }

  emitter.finish({ type: 'complete' });
  return { success: true, results };
});

const MAX_SEARCH_RESULTS = 500;
const SEARCH_CONCURRENCY = 16;

ipcMain.handle('search-files', async (_e, dirPath: string, query: string) => {
  const results: any[] = [];
  const lowerQuery = query.toLowerCase();
  const queue: string[] = [dirPath];
  const maxDepth = 5;
  const visited = new Set<string>();
  visited.add(dirPath);

  while (queue.length > 0 && results.length < MAX_SEARCH_RESULTS) {
    const batch = queue.splice(0, SEARCH_CONCURRENCY);
    const entriesArr = await Promise.allSettled(
      batch.map(p => fs.promises.readdir(p, { withFileTypes: true }))
    );
    const subdirs: string[] = [];
    for (let i = 0; i < batch.length; i++) {
      if (entriesArr[i].status !== 'fulfilled') continue;
      for (const entry of (entriesArr[i] as PromiseFulfilledResult<fs.Dirent[]>).value) {
        if (results.length >= MAX_SEARCH_RESULTS) break;
        if (entry.name.toLowerCase().includes(lowerQuery)) {
          const fullPath = path.join(batch[i], entry.name);
          try {
            const stats = await fs.promises.stat(fullPath);
            results.push({
              name: entry.name, path: fullPath,
              isDirectory: entry.isDirectory(), isFile: entry.isFile(),
              isSymlink: entry.isSymbolicLink(), size: stats.size,
              modified: stats.mtime.toISOString(),
              created: stats.birthtime.toISOString(),
              permissions: (stats.mode & 0o777).toString(8),
              icon: entry.isDirectory()
                ? resolveIcon(getFolderIcon(entry.name))
                : resolveIcon(getIconForFile(fullPath)),
            });
          } catch {}
        }
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const subdir = path.join(batch[i], entry.name);
          if (!visited.has(subdir)) {
            visited.add(subdir);
            subdirs.push(subdir);
          }
        }
      }
    }
    queue.push(...subdirs);
  }
  return results;
});

ipcMain.handle('get-file-info', async (_e, filePath: string) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return {
      name: path.basename(filePath), path: filePath,
      isDirectory: stats.isDirectory(), isFile: stats.isFile(),
      isSymlink: stats.isSymbolicLink(), size: stats.size,
      modified: stats.mtime.toISOString(),
      created: stats.birthtime.toISOString(),
      permissions: (stats.mode & 0o777).toString(8),
    };
  } catch { return null; }
});

ipcMain.handle('show-item-in-folder', (_e, p: string) => shell.showItemInFolder(p));
ipcMain.handle('open-item', (_e, p: string) => shell.openPath(p));

ipcMain.handle('launch-app', (_e, execStr: string) => {
  try {
    const { spawn } = require('child_process');
    // Parse command — handle args like "firefox %U" or "code --new-window"
    const parts = execStr.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1).map(a => a.replace(/%[fFuUdDnNickvm]/g, '')).filter(Boolean);
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
});
ipcMain.handle('open-in-terminal', async (_e, dirPath: string) => {
  const { spawn } = require('child_process');
  try {
    const impPath = path.join(process.env.HOME || '', 'imp', 'Winlator');
    if (fs.existsSync(impPath)) {
      spawn(impPath, ['--cwd', dirPath], { cwd: dirPath, detached: true, stdio: 'ignore' }).unref();
      return { success: true };
    }
    const terminals = [
      { cmd: 'konsole', args: ['--workdir', dirPath] },
      { cmd: 'kgterminal', args: ['--workdir', dirPath] },
      { cmd: 'gnome-terminal', args: [`--working-directory=${dirPath}`] },
      { cmd: 'alacritty', args: ['--working-directory', dirPath] },
      { cmd: 'kitty', args: ['--directory', dirPath] },
      { cmd: 'foot', args: [] },
      { cmd: 'xterm', args: [] },
    ];
    for (const t of terminals) {
      try {
        await run('which', [t.cmd], 2000);
        if (t.cmd) {
          spawn(t.cmd, t.args, { cwd: dirPath, detached: true, stdio: 'ignore' }).unref();
          return { success: true };
        }
      } catch {}
    }
    return { success: false, error: 'No terminal emulator found' };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
});

// ── IPC: Drive hotplug watcher ───────────────────────────────────────────────
let driveWatcher: any = null;
function startDriveWatcher(mainWindow: BrowserWindow) {
  try {
    const { spawn } = require('child_process');
    driveWatcher = spawn('udevadm', ['monitor', '--subsystem-match=block', '--property'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '';
    driveWatcher.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      // udev events are separated by double newlines
      while (buffer.includes('\n\n')) {
        const idx = buffer.indexOf('\n\n');
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (event.includes('ACTION=') && (event.includes('ACTION=add') || event.includes('ACTION=remove'))) {
          // Debounce — notify renderer after a short delay
          setTimeout(() => {
            try { mainWindow.webContents.send('drives-changed'); } catch {}
          }, 300);
        }
      }
    });
    driveWatcher.on('error', () => {});
    driveWatcher.on('close', () => { driveWatcher = null; });
  } catch {}
}
function stopDriveWatcher() {
  if (driveWatcher) { try { driveWatcher.kill(); } catch {} driveWatcher = null; }
}

// ── IPC: Open With ───────────────────────────────────────────────────────────
ipcMain.handle('get-open-with-apps', async (_e, filePath: string) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    // Get MIME type
    let mime = '';
    try { mime = (await run('file', ['--mime-type', '-b', filePath], 2000)).trim(); } catch {}

    // Find apps that handle this MIME type or extension
    const apps: { name: string; exec: string; icon?: string; desktopFile?: string }[] = [];
    const seen = new Set<string>();

    // Get default app
    let defaultApp = '';
    try { defaultApp = (await run('xdg-mime', ['query', 'default', mime], 2000)).trim(); } catch {}

    // Scan .desktop files
    const desktopDirs = [
      '/usr/share/applications',
      path.join(os.homedir(), '.local/share/applications'),
      '/var/lib/flatpak/exports/share/applications',
      '/var/lib/snapd/desktop/applications',
    ];

    for (const dir of desktopDirs) {
      try {
        const entries = await fs.promises.readdir(dir);
        for (const entry of entries) {
          if (!entry.endsWith('.desktop')) continue;
          const desktopId = entry;
          if (seen.has(desktopId)) continue;
          seen.add(desktopId);

          try {
            const content = await fs.promises.readFile(path.join(dir, entry), 'utf-8');
            const d = parseDesktopEntry(content);

            if (!d.name || !d.exec || d.noDisplay) continue;
            if (d.mimeType && (d.mimeType.includes(mime) || (ext && d.mimeType.includes(ext.slice(1))))) {
              apps.push({ name: d.name, exec: d.exec, desktopFile: entry });
            }
          } catch {}
        }
      } catch {}
    }

    // Put default app first
    if (defaultApp) {
      const idx = apps.findIndex(a => a.desktopFile && (a.desktopFile === defaultApp || defaultApp.includes(a.desktopFile)));
      if (idx > 0) { const [d] = apps.splice(idx, 1); apps.unshift(d); }
      else if (idx === -1) {
        // Default app not in our list, try to find it
        try {
          const content = await fs.promises.readFile(path.join('/usr/share/applications', defaultApp), 'utf-8');
          const d = parseDesktopEntry(content);
          if (d.name && d.exec) apps.unshift({ name: d.name, exec: d.exec, desktopFile: defaultApp });
        } catch {}
      }
    }

    // Always add "Other Application..."
    apps.push({ name: 'Other Application...', exec: '__custom__' });

    return apps.slice(0, 20);
  } catch { return []; }
});

ipcMain.handle('open-with', async (_e, filePath: string, appExec: string) => {
  try {
    if (appExec === '__custom__') {
      shell.openPath(filePath);
      return { success: true };
    }
    const { spawn } = require('child_process');
    const tokens = execToArgs(appExec, filePath);
    if (!tokens.includes(filePath)) tokens.push(filePath);
    const cmd = tokens.shift();
    const child = spawn(cmd, tokens, { detached: true, stdio: 'ignore' });
    child.on('error', (err: Error) => console.error('open-with spawn error:', err.message));
    child.unref();
    return { success: true };
  } catch (error: any) { return { success: false, error: error.message }; }
});

// ── IPC: Set desktop wallpaper (KDE/XFCE/GNOME fallback) ────────────────────
ipcMain.handle('set-wallpaper', async (_e, filePath: string): Promise<{ success: boolean; error?: string }> => {
  try {
    // Try Cutefish DE first (com.cutefish.Theme.setWallpaper)
    try {
      await run('qdbus6', ['com.cutefish.Settings', '/Theme', 'com.cutefish.Theme.setWallpaper', filePath], 5000);
      return { success: true };
    } catch {}

    // Try KDE Plasma via qdbus / qdbus6
    const escapedPath = filePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const script = `var allDesktops = desktops(); for (var i=0;i<allDesktops.length;i++) { allDesktops[i].wallpaperPlugin = 'org.kde.image'; allDesktops[i].currentConfigGroup = ['Wallpaper', 'org.kde.image', 'General']; allDesktops[i].writeConfig('Image', 'file://${escapedPath}'); }`;
    for (const qdbus of ['qdbus6', 'qdbus']) {
      try {
        await run(qdbus, ['org.kde.plasmashell', '/PlasmaShell', 'org.kde.PlasmaShell.evaluateScript', script], 5000);
        return { success: true };
      } catch {}
    }

    // Try KDE via kwriteconfig5
    try {
      await run('kwriteconfig5', ['--file', 'kwinrc', '--group', 'Desktops', '--key', 'Wallpaper', filePath], 3000);
      try { await run('qdbus6', ['org.kde.KWin', '/KWin', 'reconfigure'], 3000); } catch { await run('qdbus', ['org.kde.KWin', '/KWin', 'reconfigure'], 3000); }
      return { success: true };
    } catch {}

    // Try GNOME
    try {
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri', `file://${filePath}`], 3000);
      await run('gsettings', ['set', 'org.gnome.desktop.background', 'picture-uri-dark', `file://${filePath}`], 3000);
      return { success: true };
    } catch {}

    // Try xfconf-query (Xfce)
    try {
      await run('xfconf-query', ['-c', 'xfce4-desktop', '-p', '/backdrop/screen0/monitor0/workspace0/last-image', '--set', filePath], 3000);
      return { success: true };
    } catch {}

    // Try feh as universal fallback
    try {
      await run('feh', ['--bg-fill', filePath], 3000);
      return { success: true };
    } catch {}

    return { success: false, error: 'No supported wallpaper setter found.' };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-recent-files', async () => {
  try {
    const homeDir = os.homedir();
    const dirs = ['Downloads', 'Documents', 'Desktop', 'Pictures', 'Music', 'Videos'];
    const recent: any[] = [];
    for (const dir of dirs) {
      try {
        const entries = await fs.promises.readdir(path.join(homeDir, dir), { withFileTypes: true });
        for (const entry of entries) {
          if (recent.length >= 20) break;
          if (!entry.isFile()) continue;
          const fullPath = path.join(homeDir, dir, entry.name);
          try {
            const stats = await fs.promises.stat(fullPath);
            recent.push({
              name: entry.name, path: fullPath,
              isDirectory: false, isFile: true, isSymlink: false,
              size: stats.size, modified: stats.mtime.toISOString(),
              created: stats.birthtime.toISOString(),
              permissions: (stats.mode & 0o777).toString(8),
              parentDir: dir,
              icon: resolveIcon(getIconForFile(fullPath)),
            });
          } catch {}
        }
      } catch {}
    }
    recent.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    return recent.slice(0, 20);
  } catch { return []; }
});

// ── IPC: Archives ──────────────────────────────────────────────────────────────
ipcMain.handle('list-archive', async (_e, archivePath: string) => {
  try {
    const ext = path.extname(archivePath).toLowerCase();
    const entries: { name: string; size: number; isDir: boolean; compressedSize?: number }[] = [];

    if (ext === '.zip') {
      const output = await run('unzip', ['-l', archivePath], 10000);
      const lines = output.split('\n');
      let started = false;
      for (const line of lines) {
        if (!started) { if (line.includes('Name') && line.includes('---')) started = true; continue; }
        if (!line.trim() || line.trim().startsWith('---')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4) {
          const size = parseInt(parts[0], 10);
          const name = parts.slice(3).join(' ');
          entries.push({ name, size: isNaN(size) ? 0 : size, isDir: name.endsWith('/'), compressedSize: parseInt(parts[1], 10) });
        }
      }
    } else if (ext === '.tar' || ext === '.gz' || ext === '.bz2' || ext === '.xz') {
      const flag = ext === '.gz' ? 'tzf' : ext === '.bz2' ? 'tjf' : ext === '.xz' ? 'tJf' : 'tf';
      const output = await run('tar', [`-${flag}`, archivePath], 10000);
      for (const line of output.split('\n').filter(Boolean)) {
        entries.push({ name: line, size: 0, isDir: line.endsWith('/') });
      }
    } else if (ext === '.7z') {
      const output = await run('7z', ['l', archivePath], 10000);
      const lines = output.split('\n');
      let started = false;
      for (const line of lines) {
        if (!started) { if (line.includes('---')) { started = true; continue; } }
        if (!line.trim() || line.includes('---') || line.includes('------')) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && /^\d{4}/.test(parts[0])) {
          const name = parts.slice(5).join(' ');
          const size = parseInt(parts[2].replace(/,/g, ''), 10);
          entries.push({ name, size: isNaN(size) ? 0 : size, isDir: parts[1] === 'D' });
        }
      }
    }
    return { success: true, entries };
  } catch (e: any) {
    return { success: false, error: e.message, entries: [] };
  }
});

ipcMain.handle('extract-archive', async (_e, archivePath: string, destDir: string) => {
  const before = new Set(fs.existsSync(destDir) ? fs.readdirSync(destDir) : []);
  try {
    fs.mkdirSync(destDir, { recursive: true });
    const ext = path.extname(archivePath).toLowerCase();
    if (ext === '.zip') {
      await run('unzip', ['-o', archivePath, '-d', destDir], 60000);
    } else if (ext === '.tar' || ext === '.gz' || ext === '.bz2' || ext === '.xz') {
      const flags = ext === '.gz' ? 'xzf' : ext === '.bz2' ? 'xjf' : ext === '.xz' ? 'xJf' : 'xf';
      await run('tar', [`-${flags}`, archivePath, '-C', destDir], 60000);
    } else if (ext === '.7z') {
      await run('7z', ['x', archivePath, `-o${destDir}`, '-y'], 60000);
    } else if (ext === '.rar') {
      await run('unrar', ['x', archivePath, `${destDir}/`], 60000);
    }
    const created = fs.existsSync(destDir)
      ? fs.readdirSync(destDir).filter(n => !before.has(n)).map(n => path.join(destDir, n))
      : [];
    return { success: true, created };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('create-archive', async (event, paths: string[], destPath: string) => {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    async function addToZip(zipFolder: typeof zip, diskPath: string, relativeName: string) {
      const stat = await fs.promises.stat(diskPath);
      if (stat.isDirectory()) {
        const folder = zipFolder.folder(relativeName);
        if (!folder) return;
        const entries = await fs.promises.readdir(diskPath);
        for (const entry of entries) {
          if (entry === '.' || entry === '..') continue;
          await addToZip(folder, path.join(diskPath, entry), entry);
        }
      } else {
        const data = await fs.promises.readFile(diskPath);
        zipFolder.file(relativeName, data);
      }
    }

    for (const filePath of paths) {
      const name = path.basename(filePath);
      await addToZip(zip, filePath, name);
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(destPath, buffer);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// ── IPC: Drag state (cross-window DnD) ───────────────────────────────────────
ipcMain.on('drag-start', (e, paths: string[]) => {
  dragState = { paths, sourceWindowId: e.sender.id };
});
ipcMain.on('drag-end', () => { dragState = null; });
ipcMain.handle('get-drag-paths', () => {
  if (!dragState) return [];
  return dragState.paths;
});

ipcMain.handle('get-pinned-folders', () => {
  const homeDir = os.homedir();
  return [
    { name: 'Home', path: homeDir, icon: 'home' },
    { name: 'Desktop', path: path.join(homeDir, 'Desktop'), icon: 'desktop' },
    { name: 'Documents', path: path.join(homeDir, 'Documents'), icon: 'documents' },
    { name: 'Downloads', path: path.join(homeDir, 'Downloads'), icon: 'downloads' },
    { name: 'Pictures', path: path.join(homeDir, 'Pictures'), icon: 'pictures' },
    { name: 'Music', path: path.join(homeDir, 'Music'), icon: 'music' },
    { name: 'Videos', path: path.join(homeDir, 'Videos'), icon: 'videos' },
  ];
});

ipcMain.handle('get-trash-info', async () => {
  const t = trashDirs();
  try {
    let count = 0;
    if (fs.existsSync(t.files)) {
      const entries = await fs.promises.readdir(t.files);
      count = entries.length;
    }
    return { path: t.files, exists: fs.existsSync(t.root), count };
  } catch (error: any) {
    return { path: t.files, exists: false, count: 0, error: error.message };
  }
});
