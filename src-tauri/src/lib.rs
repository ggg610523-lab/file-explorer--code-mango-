use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};

// ── Non-blocking child-process helper ────────────────────────────────────
fn run_cmd(cmd: &str, args: &[&str], timeout_secs: u64) -> Result<String, String> {
    let mut child = Command::new(cmd)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let timeout = std::time::Duration::from_secs(timeout_secs);
    let start = std::time::Instant::now();
    loop {
        // Poll for completion with a timeout (Rust std has no timed wait).
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(_status) => {
                let mut buf = String::new();
                use std::io::Read;
                if let Some(mut stdout) = child.stdout.take() {
                    stdout.read_to_string(&mut buf).map_err(|e| e.to_string())?;
                }
                return Ok(buf);
            }
            None => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err("command timed out".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
    }
}

// A `.desktop` entry parsing result.
#[derive(Default)]
struct DesktopEntry {
    name: String,
    exec: String,
    icon: String,
    mime_type: String,
    categories: String,
    no_display: bool,
}

// Parse the `[Desktop Entry]` section of a `.desktop` file.
fn parse_desktop_entry(content: &str) -> DesktopEntry {
    let mut entry = DesktopEntry::default();
    let mut in_entry = false;
    for raw in content.split('\n') {
        let line = raw.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some(v) = line.strip_prefix("Name=") {
            if entry.name.is_empty() {
                entry.name = v.trim().to_string();
            }
        } else if let Some(v) = line.strip_prefix("Exec=") {
            if entry.exec.is_empty() {
                entry.exec = v.trim().to_string();
            }
        } else if let Some(v) = line.strip_prefix("Icon=") {
            if entry.icon.is_empty() {
                entry.icon = v.trim().to_string();
            }
        } else if let Some(v) = line.strip_prefix("MimeType=") {
            entry.mime_type = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("Categories=") {
            entry.categories = v.trim().to_string();
        } else if let Some(v) = line.strip_prefix("NoDisplay=") {
            entry.no_display = v.trim() == "true";
        }
    }
    // Strip field codes from Exec
    entry.exec = substitute_placeholders(&entry.exec, None).trim().to_string();
    entry
}

// Convert an Exec string (after % substitution) into an argv[] array.
fn exec_to_args(exec: &str, file_path: Option<&str>) -> Vec<String> {
    let substituted = substitute_placeholders(exec, file_path);
    let mut args: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut escaped = false;
    for ch in substituted.chars() {
        if escaped {
            cur.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            in_quotes = !in_quotes;
            continue;
        }
        if ch == ' ' && !in_quotes {
            if !cur.is_empty() {
                args.push(std::mem::take(&mut cur));
            }
            continue;
        }
        cur.push(ch);
    }
    if !cur.is_empty() {
        args.push(cur);
    }
    args
}

// Replace desktop-entry field codes: `%f/%F/%u/%U` with the file path, and
// drop the others (`%d/%D/%n/%N/%i/%c/%k/%v/%m`).
fn substitute_placeholders(exec: &str, file_path: Option<&str>) -> String {
    let mut out = String::new();
    let mut chars = exec.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '%' {
            let placeholder = chars.next().unwrap_or('%');
            match placeholder {
                'f' | 'F' | 'u' | 'U' => {
                    if let Some(fp) = file_path {
                        out.push_str(fp);
                    }
                }
                _ => {}
            }
        } else {
            out.push(ch);
        }
    }
    out
}

// ── Data structures ────────────────────────────────────────────────────────
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
    is_file: bool,
    is_symlink: bool,
    size: u64,
    modified: String,
    created: String,
    permissions: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DriveInfo {
    name: String,
    path: String,
    total: u64,
    free: u64,
}

fn stat_to_entry(path: &str, entry: &str, is_directory: bool, is_file: bool, is_symlink: bool) -> FileEntry {
    let full = Path::new(path).join(entry);
    let full_str = full.to_string_lossy().to_string();
    FileEntry {
        name: entry.to_string(),
        path: full_str.clone(),
        is_directory,
        is_file,
        is_symlink,
        size: 0,
        modified: String::new(),
        created: String::new(),
        permissions: String::new(),
        parent_dir: None,
        icon: None,
    }
}

// ── MIME → icon / extension → MIME tables ─────────────────────────────────
fn ext_to_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        ".png" | ".jpg" | ".jpeg" | ".gif" | ".bmp" | ".webp" | ".svg" | ".ico" | ".tiff" | ".tif" => "image",
        ".mp4" | ".webm" | ".avi" | ".mov" | ".mkv" | ".wmv" | ".flv" | ".mpg" | ".mpeg" => "video",
        ".mp3" | ".wav" | ".ogg" | ".flac" | ".aac" | ".wma" | ".m4a" | ".opus" | ".mid" => "audio",
        ".pdf" => "application/pdf",
        ".zip" => "application/zip",
        ".tar" => "application/x-tar",
        ".gz" => "application/gzip",
        ".bz2" => "application/x-bzip2",
        ".xz" => "application/x-xz",
        ".7z" => "application/x-7z-compressed",
        ".rar" => "application/vnd.rar",
        ".txt" | ".md" | ".log" | ".conf" | ".cfg" => "text",
        ".json" | ".xml" | ".yaml" | ".yml" | ".toml" | ".ini" => "text",
        ".html" | ".htm" | ".css" | ".js" | ".ts" | ".tsx" | ".jsx" | ".py" | ".sh" | ".c" | ".cpp" | ".h" | ".rs" | ".java" => "text",
        ".iso" | ".dmg" => "application/x-cd-image",
        ".doc" | ".docx" => "application/msword",
        ".xls" | ".xlsx" => "application/vnd.ms-excel",
        ".ppt" | ".pptx" => "application/vnd.ms-powerpoint",
        ".csv" | ".rtf" => "text",
        ".exe" | ".bin" | ".so" => "binary",
        _ => return None,
    })
}

fn mime_to_icon(mime: Option<&str>) -> &'static str {
    match mime {
        Some("image") => "image-x-generic",
        Some("video") => "video-x-generic",
        Some("audio") => "audio-x-generic",
        Some("application/pdf") => "application-pdf",
        Some("application/zip") | Some("application/x-tar") | Some("application/gzip")
        | Some("application/x-bzip2") | Some("application/x-xz") | Some("application/x-7z-compressed")
        | Some("application/vnd.rar") => "application-zip",
        Some("application/msword") | Some("application/vnd.ms-excel") | Some("application/vnd.ms-powerpoint") => "x-office-document",
        Some("application/x-cd-image") => "media-optical",
        Some("binary") => "application-x-executable",
        Some("text") => "text-x-generic",
        _ => "text-x-generic",
    }
}

fn get_icon_for_file(file_path: &str) -> &'static str {
    let ext = Path::new(file_path)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let mime = ext_to_mime(&ext);
    mime_to_icon(mime)
}

// ── Icon theme (Reversal) resolution ──────────────────────────────────────
// Map a folder name to an icon name (case-insensitive).
fn get_folder_icon(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    match lower.as_str() {
        "home" => "user-home",
        "desktop" => "user-desktop",
        "documents" => "folder-documents",
        "downloads" => "folder-download",
        "pictures" | "images" => "folder-images",
        "music" => "folder-music",
        "videos" => "folder-videos",
        "trash" => "user-trash",
        "templates" => "folder-templates",
        "public" => "folder-public",
        "projects" => "folder-projects",
        "tmp" | "temp" => "folder-temp",
        "web" => "web-browser",
        _ => "folder",
    }
}


#[tauri::command]
fn resolve_icon(app: AppHandle, icon_name: String) -> Option<String> {
    let state = app.state::<AppState>();
    // Try read first (concurrent, no blocking)
    {
        let guard = state.icon_index.read().unwrap();
        if let Some(idx) = guard.as_ref() {
            return idx.get(&icon_name).cloned();
        }
    }
    // Not built yet, upgrade to write
    let mut guard = state.icon_index.write().unwrap();
    if guard.is_none() {
        *guard = Some(build_icon_index(&app));
    }
    guard.as_ref().unwrap().get(&icon_name).cloned()
}

// Returns the directory that physically contains the bundled Reversal icon
// theme. Used purely as an existence oracle: the URL handed back to the
// webview is always origin-relative so <img> can load it in dev AND release.
fn icon_base_dir(app: &AppHandle) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join("reversal-icons"));
        candidates.push(dir.join("_up_").join("dist").join("renderer").join("reversal-icons"));
        candidates.push(dir.join("dist").join("renderer").join("reversal-icons"));
    }
    // Dev fallback: frontendDist is ../dist/renderer relative to src-tauri.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/renderer/reversal-icons"));
    candidates.into_iter().find(|p| p.is_dir())
}

// ── Window controls ───────────────────────────────────────────────────────
#[tauri::command]
fn window_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn window_maximize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(true) = w.is_maximized() {
            let _ = w.unmaximize();
        } else {
            let _ = w.maximize();
        }
    }
}

#[tauri::command]
fn window_close(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.close();
    }
}

#[tauri::command]
fn window_show(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// ── Theme ─────────────────────────────────────────────────────────────────
#[tauri::command]
fn get_theme(app: AppHandle) -> String {
    let dark = app
        .get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .map(|t| t == tauri::Theme::Dark)
        .unwrap_or(false);
    if dark {
        "dark".into()
    } else {
        "light".into()
    }
}

#[tauri::command]
fn set_theme(_app: AppHandle, theme: String) {
    // Tauri follows the OS theme; we just record the request so the CSS works.
    let _ = theme;
}

// ── File system basics ────────────────────────────────────────────────────
#[tauri::command]
fn get_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

// Read initial path from argv (mimics Electron's CLI parsing).
#[tauri::command]
fn get_initial_path() -> Option<String> {
    let raw: Vec<String> = std::env::args().collect();
    for a in raw.iter().skip(1) {
        if let Some(rest) = a.strip_prefix("file://") {
            let decoded = percent_decode(rest);
            if Path::new(&decoded).exists() {
                return Some(decoded);
            }
            continue;
        }
        if a.starts_with('/') && Path::new(a).exists() {
            return Some(a.clone());
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let mut out = String::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &s[i + 1..i + 3];
            if let Ok(v) = u8::from_str_radix(hex, 16) {
                out.push(v as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[tauri::command]
fn read_directory(_ctx: tauri::AppHandle, dir_path: String) -> Value {
    let read = std::fs::read_dir(&dir_path);
    match read {
        Ok(entries) => {
            let mut files: Vec<FileEntry> = Vec::new();
            for entry in entries {
                let entry = match entry {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                let name = entry.file_name().to_string_lossy().to_string();
                let full = Path::new(&dir_path).join(&name);
                let full_str = full.to_string_lossy().to_string();
                
                // Single metadata call instead of file_type() + metadata()
                let meta = match std::fs::metadata(&full) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                
                let is_dir = meta.is_dir();
                let is_file = meta.is_file();
                let is_symlink = meta.file_type().is_symlink();
                
                // Icon resolved lazily by frontend via SystemIcon batching
                let fe = FileEntry {
                    name: name.clone(),
                    path: full_str.clone(),
                    is_directory: is_dir,
                    is_file,
                    is_symlink,
                    size: meta.len(),
                    modified: meta.modified().map(|t| timestamp_iso(t)).unwrap_or_default(),
                    created: meta.created().map(|t| timestamp_iso(t)).unwrap_or_default(),
                    permissions: format!("{:o}", meta.permissions().mode() & 0o777),
                    parent_dir: None,
                    icon: None,
                };
                
                files.push(fe);
            }
            json!({ "success": true, "files": files })
        }
        Err(e) => json!({ "success": false, "error": e.to_string(), "files": [] }),
    }
}

fn timestamp_iso(t: std::time::SystemTime) -> String {
    let dt: chrono::DateTime<chrono::Utc> = t.into();
    dt.to_rfc3339()
}

// ── Drives ────────────────────────────────────────────────────────────────
#[tauri::command]
fn get_drives() -> Vec<DriveInfo> {
    let mut drives: Vec<DriveInfo> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mounts = fs::read_to_string("/proc/mounts").unwrap_or_default();
    for line in mounts.lines() {
        let parts: Vec<&str> = line.split(' ').collect();
        if parts.len() < 2 {
            continue;
        }
        let mp = parts[1];
        if seen.contains(mp) {
            continue;
        }
        if mp == "/" || mp.starts_with("/media") || mp.starts_with("/mnt") || mp.starts_with("/run/media") {
            seen.insert(mp.to_string());
            let name = if mp == "/" {
                "Root".to_string()
            } else {
                Path::new(mp)
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| mp.to_string())
            };
            drives.push(DriveInfo {
                name,
                path: mp.to_string(),
                total: 0,
                free: 0,
            });
        }
    }
    if drives.is_empty() {
        drives.push(DriveInfo {
            name: "Root".into(),
            path: "/".into(),
            total: 0,
            free: 0,
        });
    }
    drives
}

// ── Create / permissions / sudo ───────────────────────────────────────────
#[tauri::command]
fn create_folder(dir_path: String, name: String) -> Value {
    let new_path = Path::new(&dir_path).join(&name);
    match fs::create_dir_all(&new_path) {
        Ok(_) => json!({ "success": true, "path": new_path.to_string_lossy() }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn create_file(dir_path: String, name: String) -> Value {
    let new_path = Path::new(&dir_path).join(&name);
    match fs::write(&new_path, "") {
        Ok(_) => json!({ "success": true, "path": new_path.to_string_lossy() }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn set_permissions(file_path: String, mode: u32) -> Value {
    match fs::set_permissions(&file_path, std::fs::Permissions::from_mode(mode)) {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn run_with_sudo(command: String) -> Value {
    let quoted = command.replace('\'', "'\\''");
    let terminals: Vec<(&str, Vec<String>)> = vec![
        ("konsole", vec!["--hold".into(), "-e".into(), format!("pkexec bash -c '{}'", quoted)]),
        ("gnome-terminal", vec!["--".into(), "pkexec".into(), "bash".into(), "-c".into(), command.clone()]),
        ("alacritty", vec!["-e".into(), "pkexec".into(), "bash".into(), "-c".into(), command.clone()]),
        ("kitty", vec!["-e".into(), "pkexec".into(), "bash".into(), "-c".into(), command.clone()]),
        ("foot", vec![]),
        ("xterm", vec!["-e".into(), "pkexec".into(), "bash".into(), "-c".into(), command.clone()]),
    ];
    for (cmd, args) in terminals {
        if run_cmd("which", &[cmd], 5).is_ok() {
            let _ = spawn_detached(cmd, &args);
            return json!({ "success": true });
        }
    }
    json!({ "success": false, "error": "No terminal emulator found" })
}

fn spawn_detached(cmd: &str, args: &[String]) -> std::io::Result<std::process::Child> {
    Command::new(cmd)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
}

// ── Installed applications ────────────────────────────────────────────────
#[tauri::command]
fn get_applications(app: AppHandle) -> Vec<Value> {
    let home = std::env::var("HOME").unwrap_or_default();
    let dirs: Vec<String> = vec![
        "/usr/share/applications".to_string(),
        format!("{}/.local/share/applications", home),
        "/var/lib/flatpak/exports/share/applications".to_string(),
        "/var/lib/snapd/desktop/applications".to_string(),
    ];
    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<Value> = Vec::new();
    for dir in dirs {
        let entries = match fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".desktop") || name == "defaults.list" {
                continue;
            }
            if seen.contains(&name) {
                continue;
            }
            seen.insert(name.clone());
            let content = match fs::read_to_string(entry.path()) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let d = parse_desktop_entry(&content);
            if d.name.is_empty() || d.exec.is_empty() || d.no_display {
                continue;
            }
            let icon = if d.icon.starts_with('/') {
                Some(d.icon.clone())
            } else {
                resolve_icon(app.clone(), d.icon.clone())
            };
            apps.push(json!({
                "name": d.name,
                "exec": d.exec,
                "icon": icon,
                "desktopFile": name,
                "categories": d.categories,
            }));
        }
    }
    apps.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    apps
}
// ── Rename ────────────────────────────────────────────────────────────────
#[tauri::command]
fn rename(old_path: String, new_name: String) -> Value {
    let new_path = Path::new(&old_path).parent().map(|p| p.join(&new_name));
    let new_path = match new_path {
        Some(p) => p,
        None => return json!({ "success": false, "error": "invalid path" }),
    };
    match fs::rename(&old_path, &new_path) {
        Ok(_) => json!({ "success": true, "path": new_path.to_string_lossy() }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

// ── Trash (Freedesktop-style) helpers ─────────────────────────────────────
fn trash_dirs(home: &str) -> (String, String) {
    let root = format!("{}/.local/share/Trash", home);
    (format!("{}/files", root), format!("{}/info", root))
}

fn ensure_trash(home: &str) -> (String, String) {
    let (files, info) = trash_dirs(home);
    let _ = fs::create_dir_all(&files);
    let _ = fs::create_dir_all(&info);
    (files, info)
}

fn unique_name(dir: &str, name: &str) -> String {
    if !Path::new(dir).join(name).exists() {
        return name.to_string();
    }
    let dot = name.rfind('.');
    let (base, ext) = match dot {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    let mut i = 1;
    let mut candidate = format!("{} ({}){}", base, i, ext);
    while Path::new(dir).join(&candidate).exists() {
        i += 1;
        candidate = format!("{} ({}){}", base, i, ext);
    }
    candidate
}

fn move_to_trash(source: &str) -> std::io::Result<()> {
    let home = std::env::var("HOME").unwrap_or_default();
    let (files, info) = ensure_trash(&home);
    let name = unique_name(&files, &Path::new(source).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default());
    let dest = Path::new(&files).join(&name);
    fs::rename(source, &dest)?;
    let info_content = format!(
        "[Trash Info]\nPath={}\nDeletionDate={}\n",
        urlencode(source),
        timestamp_iso(std::time::SystemTime::now())
    );
    fs::write(Path::new(&info).join(format!("{}.trashinfo", name)), info_content)?;
    Ok(())
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_./~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn broadcast_trash_changed(app: &AppHandle) {
    let _ = app.emit("trash-changed", ());
}

#[tauri::command]
fn delete_items(app: AppHandle, paths: Vec<String>) -> Vec<Value> {
    let home = std::env::var("HOME").unwrap_or_default();
    let (files, _info) = trash_dirs(&home);
    let mut results: Vec<Value> = Vec::new();
    let mut any_trashed = false;
    for p in paths {
        let res = (|| -> Result<(), String> {
            let parent = Path::new(&p)
                .parent()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or_default();
            if parent == files {
                fs::remove_dir_all(&p).or_else(|_| fs::remove_file(&p)).map_err(|e| e.to_string())?;
            } else {
                move_to_trash_inner(&p).map_err(|e| e.to_string())?;
            }
            any_trashed = true;
            Ok(())
        })();
        results.push(json!({ "path": p, "success": res.is_ok(), "error": res.err() }));
    }
    if any_trashed {
        broadcast_trash_changed(&app);
    }
    results
}

fn move_to_trash_inner(source: &str) -> std::io::Result<()> {
    move_to_trash(source)
}

#[tauri::command]
fn restore_item(app: AppHandle, trash_path: String) -> Value {
    let home = std::env::var("HOME").unwrap_or_default();
    let (_files, info) = trash_dirs(&home);
    let name = Path::new(&trash_path)
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut original = String::new();
    if let Ok(content) = fs::read_to_string(Path::new(&info).join(format!("{}.trashinfo", name))) {
        for line in content.lines() {
            if let Some(v) = line.strip_prefix("Path=") {
                original = percent_decode(v);
                break;
            }
        }
    }
    if original.is_empty() || !Path::new(&original).is_absolute() {
        original = Path::new(&home).join(&name).to_string_lossy().to_string();
    }
    let parent = Path::new(&original)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| home.clone());
    let target = Path::new(&parent).join(unique_name(
        &parent,
        &Path::new(&original).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
    ));
    match fs::rename(&trash_path, &target) {
        Ok(_) => {
            let _ = fs::remove_file(Path::new(&info).join(format!("{}.trashinfo", name)));
            broadcast_trash_changed(&app);
            json!({ "success": true, "path": target.to_string_lossy() })
        }
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn empty_trash(app: AppHandle) -> Value {
    let home = std::env::var("HOME").unwrap_or_default();
    let (files, info) = trash_dirs(&home);
    let mut ok = true;
    if let Ok(items) = fs::read_dir(&files) {
        for it in items.flatten() {
            let _ = fs::remove_dir_all(it.path()).or_else(|_| fs::remove_file(it.path()));
            ok = it.path().exists() == false;
        }
    }
    if let Ok(items) = fs::read_dir(&info) {
        for it in items.flatten() {
            let _ = fs::remove_dir_all(it.path()).or_else(|_| fs::remove_file(it.path()));
        }
    }
    broadcast_trash_changed(&app);
    json!({ "success": ok })
}
// ── Copy / move (with progress events) ────────────────────────────────────
#[derive(Clone, Serialize)]
struct ProgressState {
    files_done: u64,
    bytes_done: u64,
    total_files: u64,
    total_bytes: u64,
    operation: String,
    current_file: String,
}

fn send_progress(app: &AppHandle, state: &ProgressState) {
    let _ = app.emit(
        "copy-progress",
        json!({
            "type": "progress",
            "currentFile": state.current_file,
            "filesDone": state.files_done,
            "totalFiles": state.total_files,
            "bytesDone": state.bytes_done,
            "totalBytes": state.total_bytes,
            "operation": state.operation,
        }),
    );
}

fn count_files_recursive(dir_path: &str) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    if let Ok(entries) = fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let full = entry.path();
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let (f, b) = count_files_recursive(&full.to_string_lossy());
                files += f;
                bytes += b;
            } else {
                files += 1;
                if let Ok(m) = fs::metadata(&full) {
                    bytes += m.len();
                }
            }
        }
    }
    (files, bytes)
}

fn copy_dir_recursive(src: &str, dest: &str, state: &mut ProgressState, app: &AppHandle) -> std::io::Result<()> {
    fs::create_dir_all(dest)?;
    let entries = fs::read_dir(src)?;
    for entry in entries.flatten() {
        let s = entry.path();
        let d = Path::new(dest).join(entry.file_name());
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir_recursive(&s.to_string_lossy(), &d.to_string_lossy(), state, app)?;
        } else {
            let meta = fs::metadata(&s)?;
            fs::copy(&s, &d)?;
            state.files_done += 1;
            state.bytes_done += meta.len();
            state.current_file = entry.file_name().to_string_lossy().to_string();
            send_progress(app, state);
        }
    }
    Ok(())
}

fn count_total(sources: &[String]) -> (u64, u64) {
    let (mut total_files, mut total_bytes) = (0u64, 0u64);
    for src in sources {
        if let Ok(m) = fs::metadata(src) {
            if m.is_dir() {
                let (f, b) = count_files_recursive(src);
                total_files += f;
                total_bytes += b;
            } else {
                total_files += 1;
                total_bytes += m.len();
            }
        }
    }
    (total_files, total_bytes)
}
#[tauri::command]
fn copy_items(app: AppHandle, sources: Vec<String>, destination: String) -> Vec<Value> {
    let basenames: Vec<String> = sources
        .iter()
        .map(|s| Path::new(s).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default())
        .collect();
    let (total_files, total_bytes) = count_total(&sources);
    let _ = app.emit(
        "copy-progress",
        json!({ "type": "start", "totalFiles": total_files, "totalBytes": total_bytes, "operation": "copy", "sources": basenames }),
    );
    let mut state = ProgressState {
        files_done: 0,
        bytes_done: 0,
        total_files,
        total_bytes,
        operation: "copy".into(),
        current_file: String::new(),
    };
    let mut results: Vec<Value> = Vec::new();
    for source in sources {
        let dest = Path::new(&destination).join(Path::new(&source).file_name().unwrap_or_default());
        let r = (|| -> Result<(), String> {
            let m = fs::metadata(&source).map_err(|e| e.to_string())?;
            if m.is_dir() {
                copy_dir_recursive(&source, &dest.to_string_lossy(), &mut state, &app).map_err(|e| e.to_string())?;
            } else {
                fs::copy(&source, &dest).map_err(|e| e.to_string())?;
                state.files_done += 1;
                state.bytes_done += m.len();
                state.current_file = Path::new(&source).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                send_progress(&app, &state);
            }
            Ok(())
        })();
        results.push(json!({ "source": source, "dest": dest.to_string_lossy(), "success": r.is_ok(), "error": r.err() }));
    }
    let _ = app.emit("copy-progress", json!({ "type": "complete" }));
    results
}

#[tauri::command]
fn move_items(app: AppHandle, sources: Vec<String>, destination: String) -> Value {
    let basenames: Vec<String> = sources
        .iter()
        .map(|s| Path::new(s).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default())
        .collect();
    let (total_files, total_bytes) = count_total(&sources);
    let _ = app.emit(
        "copy-progress",
        json!({ "type": "start", "totalFiles": total_files, "totalBytes": total_bytes, "operation": "move", "sources": basenames }),
    );
    let mut state = ProgressState {
        files_done: 0,
        bytes_done: 0,
        total_files,
        total_bytes,
        operation: "move".into(),
        current_file: String::new(),
    };
    let mut results: Vec<Value> = Vec::new();
    for source in sources {
        let dest = Path::new(&destination).join(Path::new(&source).file_name().unwrap_or_default());
        let r = (|| -> Result<(), String> {
            let res = fs::rename(&source, &dest);
            if let Err(e) = res {
                if e.raw_os_error() == Some(18) {
                    copy_dir_recursive(&source, &dest.to_string_lossy(), &mut state, &app).map_err(|e| e.to_string())?;
                    fs::remove_dir_all(&source).or_else(|_| fs::remove_file(&source)).map_err(|e| e.to_string())?;
                } else {
                    return Err(e.to_string());
                }
            }
            if let Ok(m) = fs::metadata(&dest) {
                state.files_done += 1;
                state.bytes_done += m.len();
            }
            state.current_file = Path::new(&source).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            send_progress(&app, &state);
            Ok(())
        })();
        results.push(json!({ "source": source, "dest": dest.to_string_lossy(), "success": r.is_ok(), "error": r.err() }));
    }
    let _ = app.emit("copy-progress", json!({ "type": "complete" }));
    json!({ "success": true, "results": results })
}
// ── Search ────────────────────────────────────────────────────────────────
#[tauri::command]
fn search_files(app: AppHandle, dir_path: String, query: String) -> Vec<Value> {
    let lower = query.to_lowercase();
    let mut results: Vec<Value> = Vec::new();
    let mut queue: Vec<String> = vec![dir_path.clone()];
    let mut visited = std::collections::HashSet::new();
    visited.insert(dir_path.clone());
    let mut depth = 0;
    while !queue.is_empty() && results.len() < 500 && depth < 5 {
        let batch = queue.drain(..).collect::<Vec<_>>();
        let mut subdirs: Vec<String> = Vec::new();
        for p in batch {
            let entries = match fs::read_dir(&p) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                if results.len() >= 500 {
                    break;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.to_lowercase().contains(&lower) {
                    let full = entry.path();
                    let full_str = full.to_string_lossy().to_string();
                    let ft = match entry.file_type() {
                        Ok(t) => t,
                        Err(_) => continue,
                    };
                    let mut fe = stat_to_entry(&p, &name, ft.is_dir(), ft.is_file(), ft.is_symlink());
                    if let Ok(meta) = fs::metadata(&full) {
                        fe.size = meta.len();
                        fe.modified = meta.modified().map(timestamp_iso).unwrap_or_default();
                        fe.created = meta.created().map(timestamp_iso).unwrap_or_default();
                        fe.permissions = format!("{:o}", meta.permissions().mode() & 0o777);
                    }
                    fe.icon = if ft.is_dir() {
                        resolve_icon(app.clone(), get_folder_icon(&name).to_string())
                    } else {
                        resolve_icon(app.clone(), get_icon_for_file(&full_str).to_string())
                    };
                    results.push(serde_json::to_value(&fe).unwrap_or(Value::Null));
                }
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) && !name.starts_with('.') {
                    let sub = entry.path().to_string_lossy().to_string();
                    if !visited.contains(&sub) {
                        visited.insert(sub.clone());
                        subdirs.push(sub);
                    }
                }
            }
        }
        queue = subdirs;
        depth += 1;
    }
    results
}

#[tauri::command]
fn get_file_info(file_path: String) -> Option<Value> {
    let meta = fs::metadata(&file_path).ok()?;
    Some(json!({
        "name": Path::new(&file_path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
        "path": file_path,
        "isDirectory": meta.is_dir(),
        "isFile": meta.is_file(),
        "isSymlink": meta.file_type().is_symlink(),
        "size": meta.len(),
        "modified": meta.modified().map(timestamp_iso).unwrap_or_default(),
        "created": meta.created().map(timestamp_iso).unwrap_or_default(),
        "permissions": format!("{:o}", meta.permissions().mode() & 0o777),
    }))
}

// ── Open / show ───────────────────────────────────────────────────────────
#[tauri::command]
fn open_item(item_path: String) {
    let _ = xdg_open(&item_path);
}

#[tauri::command]
fn show_item_in_folder(item_path: String) {
    let _ = xdg_open(&item_path);
}

fn xdg_open(path: &str) -> Result<(), String> {
    match run_cmd("xdg-open", &[path], 10) {
        Ok(_) => Ok(()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
fn launch_app(exec_str: String) -> Value {
    let parts: Vec<&str> = exec_str.split_whitespace().collect();
    if parts.is_empty() {
        return json!({ "success": false, "error": "empty command" });
    }
    let args: Vec<String> = parts[1..]
        .iter()
        .map(|a| a.replace("%F", "").replace("%f", ""))
        .filter(|a| !a.is_empty())
        .collect();
    match spawn_detached(parts[0], &args) {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e.to_string() }),
    }
}

#[tauri::command]
fn open_in_terminal(dir_path: String) -> Value {
    let terminals: Vec<(&str, Vec<String>)> = vec![
        ("konsole", vec!["--workdir".into(), dir_path.clone()]),
        ("kgterminal", vec!["--workdir".into(), dir_path.clone()]),
        ("gnome-terminal", vec![format!("--working-directory={}", dir_path)]),
        ("alacritty", vec!["--working-directory".into(), dir_path.clone()]),
        ("kitty", vec!["--directory".into(), dir_path.clone()]),
        ("foot", vec![]),
        ("xterm", vec![]),
    ];
    for (cmd, args) in terminals {
        if run_cmd("which", &[cmd], 5).is_ok() {
            let _ = spawn_detached(cmd, &args);
            return json!({ "success": true });
        }
    }
    json!({ "success": false, "error": "No terminal emulator found" })
}
// ── Wallpaper ─────────────────────────────────────────────────────────────
#[tauri::command]
fn set_wallpaper(file_path: String) -> Value {
    if run_cmd("qdbus6", &["com.cutefish.Settings", "/Theme", "com.cutefish.Theme.setWallpaper", &file_path], 5).is_ok() {
        return json!({ "success": true });
    }
    let script = format!(
        "var allDesktops = desktops(); for (var i=0;i<allDesktops.length;i++) {{ allDesktops[i].wallpaperPlugin = 'org.kde.image'; allDesktops[i].currentConfigGroup = ['Wallpaper', 'org.kde.image', 'General']; allDesktops[i].writeConfig('Image', 'file://{}'); }}",
        file_path.replace('\\', "\\\\").replace('\'', "\\'")
    );
    for qdbus in ["qdbus6", "qdbus"] {
        if run_cmd(qdbus, &["org.kde.plasmashell", "/PlasmaShell", "org.kde.PlasmaShell.evaluateScript", &script], 5).is_ok() {
            return json!({ "success": true });
        }
    }
    if run_cmd("gsettings", &["set", "org.gnome.desktop.background", "picture-uri", &format!("file://{}", file_path)], 5).is_ok() {
        return json!({ "success": true });
    }
    if run_cmd("xfconf-query", &["-c", "xfce4-desktop", "-p", "/backdrop/screen0/monitor0/workspace0/last-image", "--set", &file_path], 5).is_ok() {
        return json!({ "success": true });
    }
    if run_cmd("feh", &["--bg-fill", &file_path], 5).is_ok() {
        return json!({ "success": true });
    }
    json!({ "success": false, "error": "No supported wallpaper setter found" })
}

// ── Recent files ──────────────────────────────────────────────────────────
#[tauri::command]
fn get_recent_files(app: AppHandle) -> Vec<Value> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut recent: Vec<Value> = Vec::new();
    let dirs = ["Downloads", "Documents", "Desktop", "Pictures", "Music", "Videos"];
    for dir in dirs {
        let base = Path::new(&home).join(dir);
        if let Ok(entries) = fs::read_dir(&base) {
            for entry in entries.flatten() {
                if recent.len() >= 20 {
                    break;
                }
                if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    continue;
                }
                let full = entry.path();
                if let Ok(meta) = fs::metadata(&full) {
                    let full_str = full.to_string_lossy().to_string();
                    recent.push(json!({
                        "name": entry.file_name().to_string_lossy().to_string(),
                        "path": full_str,
                        "isDirectory": false, "isFile": true, "isSymlink": false,
                        "size": meta.len(),
                        "modified": meta.modified().map(timestamp_iso).unwrap_or_default(),
                        "created": meta.created().map(timestamp_iso).unwrap_or_default(),
                        "permissions": format!("{:o}", meta.permissions().mode() & 0o777),
                        "parentDir": dir,
                        "icon": resolve_icon(app.clone(), get_icon_for_file(&Path::new(&full_str).to_string_lossy()).to_string()),
                    }));
                }
            }
        }
        if recent.len() >= 20 {
            break;
        }
    }
    recent.sort_by(|a, b| {
        b["modified"]
            .as_str()
            .unwrap_or("")
            .cmp(a["modified"].as_str().unwrap_or(""))
    });
    recent.truncate(20);
    recent
}

#[tauri::command]
fn get_pinned_folders() -> Vec<Value> {
    let home = std::env::var("HOME").unwrap_or_default();
    vec![
        json!({ "name": "Home", "path": home, "icon": "home" }),
        json!({ "name": "Desktop", "path": format!("{}/Desktop", home), "icon": "desktop" }),
        json!({ "name": "Documents", "path": format!("{}/Documents", home), "icon": "documents" }),
        json!({ "name": "Downloads", "path": format!("{}/Downloads", home), "icon": "downloads" }),
        json!({ "name": "Pictures", "path": format!("{}/Pictures", home), "icon": "pictures" }),
        json!({ "name": "Music", "path": format!("{}/Music", home), "icon": "music" }),
        json!({ "name": "Videos", "path": format!("{}/Videos", home), "icon": "videos" }),
    ]
}

#[tauri::command]
fn get_trash_info() -> Value {
    let home = std::env::var("HOME").unwrap_or_default();
    let (files, _info) = trash_dirs(&home);
    let count = fs::read_dir(&files).map(|e| e.count()).unwrap_or(0);
    json!({ "path": files, "exists": Path::new(&files).exists(), "count": count })
}
#[tauri::command]
fn resolve_icons(app: AppHandle, items: Vec<serde_json::Value>) -> std::collections::HashMap<String, Option<String>> {
    let mut out = std::collections::HashMap::new();
    for item in items {
        let path = item["path"].as_str().unwrap_or("");
        let is_dir = item["isDir"].as_bool().unwrap_or(false);
        let name = item["name"].as_str().unwrap_or("");
        let icon = if is_dir {
            resolve_icon(app.clone(), get_folder_icon(name).to_string())
        } else {
            resolve_icon(app.clone(), get_icon_for_file(path).to_string())
        };
        out.insert(path.to_string(), icon);
    }
    out
}

#[tauri::command]
fn get_special_icons(app: AppHandle) -> std::collections::HashMap<String, Option<String>> {
    let mut out = std::collections::HashMap::new();
    for (key, name) in [
        ("home", "user-home"),
        ("desktop", "user-desktop"),
        ("documents", "folder-documents"),
        ("downloads", "folder-download"),
        ("pictures", "folder-images"),
        ("music", "folder-music"),
        ("videos", "folder-videos"),
        ("trash", "user-trash"),
        ("drive", "drive-harddisk"),
        ("network", "network-server"),
    ] {
        if key != "drive" && key != "network" {
            out.insert(key.to_string(), resolve_icon(app.clone(), name.to_string()));
        }
    }
    let drive = resolve_icon(app.clone(), "drive-harddisk".into())
        .or_else(|| resolve_icon(app.clone(), "drive".into()));
    let network = resolve_icon(app.clone(), "network-server".into())
        .or_else(|| resolve_icon(app.clone(), "network-workgroup".into()));
    out.insert("drive".into(), drive);
    out.insert("network".into(), network);
    out
}

// ── Open With ─────────────────────────────────────────────────────────────
#[tauri::command]
fn get_open_with_apps(app: AppHandle, file_path: String) -> Vec<Value> {
    let ext = Path::new(&file_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = run_cmd("file", &["--mime-type", "-b", &file_path], 5).unwrap_or_default();
    let mime = mime.trim();
    let default_app = run_cmd("xdg-mime", &["query", "default", mime], 5).unwrap_or_default();
    let default_app = default_app.trim().to_string();
    let ext_without_dot = ext.clone();

    let home = std::env::var("HOME").unwrap_or_default();
    let dirs: Vec<String> = vec![
        "/usr/share/applications".to_string(),
        format!("{}/.local/share/applications", home),
        "/var/lib/flatpak/exports/share/applications".to_string(),
        "/var/lib/snapd/desktop/applications".to_string(),
    ];
    let mut seen = std::collections::HashSet::new();
    let mut apps: Vec<Value> = Vec::new();
    for dir in dirs {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.ends_with(".desktop") || seen.contains(&name) {
                    continue;
                }
                seen.insert(name.clone());
                let content = match fs::read_to_string(entry.path()) {
                    Ok(c) => c,
                    Err(_) => continue,
                };
                let d = parse_desktop_entry(&content);
                if d.name.is_empty() || d.exec.is_empty() || d.no_display {
                    continue;
                }
                let matches = d.mime_type.contains(mime)
                    || (!ext_without_dot.is_empty() && d.mime_type.contains(&ext_without_dot));
                if matches {
                    let icon = if d.icon.starts_with('/') {
                        Some(d.icon.clone())
                    } else {
                        resolve_icon(app.clone(), d.icon.clone())
                    };
                    apps.push(json!({ "name": d.name, "exec": d.exec, "icon": icon, "desktopFile": name }));
                }
            }
        }
    }
    // Default app first
    if !default_app.is_empty() {
        if let Some(idx) = apps.iter().position(|a| a["desktopFile"].as_str().unwrap_or("") == default_app) {
            if idx > 0 {
                let app_obj = apps.remove(idx);
                apps.insert(0, app_obj);
            }
        } else if let Ok(content) = fs::read_to_string(format!("/usr/share/applications/{}", default_app)) {
            let d = parse_desktop_entry(&content);
            if !d.name.is_empty() && !d.exec.is_empty() {
                let icon = resolve_icon(app.clone(), d.icon.clone());
                apps.insert(0, json!({ "name": d.name, "exec": d.exec, "icon": icon, "desktopFile": default_app }));
            }
        }
    }
    apps.push(json!({ "name": "Other Application...", "exec": "__custom__" }));
    apps.truncate(20);
    apps
}

#[tauri::command]
fn open_with(file_path: String, app_exec: String) -> Value {
    if app_exec == "__custom__" {
        let _ = xdg_open(&file_path);
        return json!({ "success": true });
    }
    let args = exec_to_args(&app_exec, Some(&file_path));
    if !args.iter().any(|a| a == &file_path) {
        let mut full = args;
        full.push(file_path.clone());
        match spawn_detached(&full[0], &full[1..].to_vec()) {
            Ok(_) => json!({ "success": true }),
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        }
    } else {
        match spawn_detached(&args[0], &args[1..].to_vec()) {
            Ok(_) => json!({ "success": true }),
            Err(e) => json!({ "success": false, "error": e.to_string() }),
        }
    }
}
// ── Archives ──────────────────────────────────────────────────────────────
#[tauri::command]
fn list_archive(archive_path: String) -> Value {
    let ext = Path::new(&archive_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut entries: Vec<Value> = Vec::new();
    match ext.as_str() {
        "zip" => {
            if let Ok(output) = run_cmd("unzip", &["-l", &archive_path], 10) {
                let mut started = false;
                for line in output.lines() {
                    if !started {
                        if line.contains("Name") && line.contains("---") {
                            started = true;
                        }
                        continue;
                    }
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("---") {
                        continue;
                    }
                    let parts: Vec<&str> = trimmed.split_whitespace().collect();
                    if parts.len() >= 4 {
                        let size = parts[0].parse::<u64>().unwrap_or(0);
                        let name = parts[3..].join(" ");
                        entries.push(json!({ "name": name, "size": size, "isDir": name.ends_with('/') }));
                    }
                }
            }
            json!({ "success": true, "entries": entries })
        }
        "tar" | "gz" | "bz2" | "xz" => {
            let flags = match ext.as_str() {
                "gz" => "tzf",
                "bz2" => "tjf",
                "xz" => "tJf",
                _ => "tf",
            };
            if let Ok(output) = run_cmd("tar", &[flags, &archive_path], 10) {
                for line in output.lines() {
                    let name = line.trim();
                    if !name.is_empty() {
                        entries.push(json!({ "name": name, "size": 0, "isDir": name.ends_with('/') }));
                    }
                }
            }
            json!({ "success": true, "entries": entries })
        }
        _ => json!({ "success": false, "entries": entries, "error": "unsupported archive type" }),
    }
}

#[tauri::command]
fn extract_archive(archive_path: String, dest_dir: String) -> Value {
    let ext = Path::new(&archive_path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let before: std::collections::HashSet<String> = fs::read_dir(&dest_dir)
        .map(|e| e.flatten().map(|i| i.file_name().to_string_lossy().to_string()).collect())
        .unwrap_or_default();
    let _ = fs::create_dir_all(&dest_dir);
    let r = match ext.as_str() {
        "zip" => run_cmd("unzip", &["-o", &archive_path, "-d", &dest_dir], 60),
        "tar" | "gz" | "bz2" | "xz" => {
            let flags = match ext.as_str() {
                "gz" => "xzf",
                "bz2" => "xjf",
                "xz" => "xJf",
                _ => "xf",
            };
            run_cmd("tar", &[&format!("-{}", flags), &archive_path, "-C", &dest_dir], 60)
        }
        "7z" => run_cmd("7z", &["x", &archive_path, &format!("-o{}", dest_dir), "-y"], 60),
        "rar" => run_cmd("unrar", &["x", &archive_path, &format!("{}/", dest_dir)], 60),
        _ => return json!({ "success": false, "error": "unsupported archive type" }),
    };
    match r {
        Ok(_) => {
            let created: Vec<String> = fs::read_dir(&dest_dir)
                .map(|e| {
                    e.flatten()
                        .map(|i| i.file_name().to_string_lossy().to_string())
                        .filter(|n| !before.contains(n))
                        .map(|n| Path::new(&dest_dir).join(n).to_string_lossy().to_string())
                        .collect()
                })
                .unwrap_or_default();
            json!({ "success": true, "created": created })
        }
        Err(e) => json!({ "success": false, "error": e }),
    }
}

#[tauri::command]
fn create_archive(paths: Vec<String>, dest_path: String) -> Value {
    // Use the system `zip` tool (widely available on Linux desktops).
    let mut args: Vec<String> = vec!["-r".into(), "-y".into(), "-q".into(), dest_path.clone()];
    for p in &paths {
        let name = Path::new(p).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        args.push(name);
    }
    let cwd = paths
        .first()
        .and_then(|p| Path::new(p).parent())
        .map(|p| p.to_string_lossy().to_string());
    let res = (|| -> Result<(), String> {
        if let Some(parent) = Path::new(&dest_path).parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::remove_file(&dest_path);
        let workdir = cwd.ok_or("no parent dir")?;
        let out = Command::new("zip")
            .args(&args)
            .current_dir(&workdir)
            .spawn()
            .and_then(|mut c| c.wait())
            .map_err(|e| e.to_string())?;
        if out.success() {
            Ok(())
        } else {
            Err("zip failed".into())
        }
    })();
    match res {
        Ok(_) => json!({ "success": true }),
        Err(e) => json!({ "success": false, "error": e }),
    }
}
// ── Drag state (cross-window) ─────────────────────────────────────────────
use std::sync::{Mutex, RwLock};

struct AppState {
    drag_path: Mutex<Vec<String>>,
    // One-time scan of the bundled icon theme: icon name -> origin-relative
    // URL. Avoids dozens of `exists()` syscalls per icon on the hot path.
    icon_index: RwLock<Option<std::collections::HashMap<String, String>>>,
}

// Scan the Reversal theme once and map every icon name to its best-ranked URL.
// Size priority: 32 > 22 > scalable > 48 (matches the original Electron port).
fn build_icon_index(app: &AppHandle) -> std::collections::HashMap<String, String> {
    let mut idx = std::collections::HashMap::new();
    let Some(base) = icon_base_dir(app) else { return idx };
    let categories = [
        "places", "mimes", "devices", "apps", "actions", "categories", "status", "emblems",
    ];
    for cat in categories.iter() {
        for size in ["32", "22", "scalable", "48"] {
            let dir = base.join(cat).join(size);
            let Ok(files) = fs::read_dir(&dir) else { continue };
            for f in files.flatten() {
                let name = f.file_name().to_string_lossy().to_string();
                let Some((stem, ext)) = name.rsplit_once('.') else { continue };
                if ext != "svg" && ext != "png" {
                    continue;
                }
                let url = format!("/reversal-icons/{}/{}/{}", cat, size, name);
                idx.entry(stem.to_string()).or_insert(url);
            }
        }
    }
    idx
}

#[tauri::command]
fn drag_start(state: tauri::State<AppState>, paths: Vec<String>) {
    *state.drag_path.lock().unwrap() = paths;
}

#[tauri::command]
fn drag_end(state: tauri::State<AppState>) {
    state.drag_path.lock().unwrap().clear();
}

#[tauri::command]
fn get_drag_paths(state: tauri::State<AppState>) -> Vec<String> {
    state.drag_path.lock().unwrap().clone()
}

// ── Thumbnail bytes (replaces Electron's `thumbnails://` protocol) ──────
#[tauri::command]
fn read_thumbnail(file_path: String) -> Value {
    match fs::read(&file_path) {
        Ok(bytes) => {
            use base64::Engine;
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
            json!({ "ok": true, "data": encoded })
        }
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

// ── App bootstrap ─────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            drag_path: Mutex::new(Vec::new()),
            icon_index: RwLock::new(None),
        })
        .setup(|app| {
            // Warm the icon-theme index in the background so the first
            // directory listing never waits for the ~10k-file theme scan —
            // it overlaps with webview load instead.
            let icon_handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = icon_handle.state::<AppState>();
                let mut guard = state.icon_index.write().unwrap();
                if guard.is_none() {
                    *guard = Some(build_icon_index(&icon_handle));
                }
            });
            // Notify renderer when drives change (polling is lightweight here).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last = String::new();
                loop {
                    let current = fs::read_to_string("/proc/mounts").unwrap_or_default();
                    if current != last && !last.is_empty() {
                        let _ = handle.emit("drives-changed", ());
                    }
                    last = current;
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_minimize,
            window_maximize,
            window_close,
            window_show,
            get_theme,
            set_theme,
            get_home_dir,
            get_initial_path,
            read_directory,
            get_drives,
            create_folder,
            create_file,
            set_permissions,
            run_with_sudo,
            get_applications,
            rename,
            delete_items,
            copy_items,
            move_items,
            search_files,
            get_file_info,
            open_item,
            show_item_in_folder,
            launch_app,
            open_in_terminal,
            set_wallpaper,
            get_recent_files,
            get_pinned_folders,
            get_trash_info,
            restore_item,
            empty_trash,
            resolve_icon,
            resolve_icons,
            get_special_icons,
            get_open_with_apps,
            open_with,
            list_archive,
            extract_archive,
            create_archive,
            drag_start,
            drag_end,
            get_drag_paths,
            read_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
