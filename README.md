# File Explorer (Windows 11-style) — Electron ⇄ Tauri

A modern Linux file explorer inspired by Windows 11 (25H2), built with **React +
TypeScript**. It ships as **both** an Electron app and a **Tauri 2** desktop app
from the same renderer codebase.

## Project layout

```
src/main/     Electron main process (all FS/OS logic, IPC handlers)
src/preload/  Electron preload bridge (exposes window.api)
src/renderer/ React UI (components, hooks, theme, thumbnail manager)
  api.ts      Tauri-backed window.api bridge (used when running under Tauri)
src-tauri/    Tauri 2 backend (Rust) implementing the same commands as IPC
```

The renderer talks to the platform only through `window.api.*`. Under Electron
that object is provided by the preload script; under Tauri it is provided by
`src/renderer/api.ts`, which wires every method to a Rust command behind Tauri's
IPC. The React components themselves are identical in both shells.

## Requirements

- **Electron**: Node ≥ 18, `npm install` only.
- **Tauri**: Rust toolchain, plus the WebKitGTK stack on Linux:
  `webkit2gtk-4.1`, `gtk3`, `libsoup-3.0`, `javascriptcoregtk-4.1`,
  `librsvg2-dev`, etc. (The `tauri` crate links against these at compile time.)

## Run (Electron)

```sh
npm install
npm start          # build + run electron
```

## Run (Tauri)

```sh
npm install
npm run tauri:dev  # builds dist/renderer, then launches the Tauri app
```

## Build (Tauri) — Linux AppImage / deb

```sh
npm run tauri:build
```

The webpack renderer output lives in `dist/renderer`; `src-tauri/tauri.conf.json`
`build.frontendDist` points at that folder, so the Tauri binary ships the same UI
bundle as the Electron build.

## Port notes

- All FS/OS work (read dirs, create/rename/delete, trash, archives, wallpaper,
  drives, icons, `.desktop` parsing) moved from the Electron main process into
the Rust backend in `src-tauri/src/lib.rs`, exposed as Tauri commands.
- UI-progress events (`copy-progress`, `drives-changed`, `trash-changed`) are
  forwarded from Rust to the renderer with Tauri `emit`/`listen`.
- The Electron-only `thumbnails://` custom protocol was replaced by a
  `read_thumbnail` command returning base64 bytes, which the renderer turns into
  object URLs for image/video/audio previews.
- Window controls and theming reimplemented as Tauri commands
  (`window_minimize/maximize/close`, `get_theme`, `set_theme`).
# tauri-file
# tauri-file
