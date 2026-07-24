# SnipVault - Desktop App Build Instructions

SnipVault is a code snippets library that can run as both a web app and a native desktop app using Tauri.

## Prerequisites

### For Desktop App (Tauri)

1. **Rust**: Install from https://rustup.rs/
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **System dependencies** (varies by OS):

   **macOS:**
   ```bash
   xcode-select --install
   ```

   **Ubuntu/Debian:**
   ```bash
   sudo apt update
   sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
   ```

   **Windows:**
   - Install [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   - Install [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)

## Installation

```bash
pnpm install
```

## Development

### Web App (Browser)
```bash
pnpm dev
```
Then open http://localhost:3000

### Desktop App (Tauri)
```bash
pnpm tauri:dev
```
This will start the Next.js dev server and open the Tauri window.

## Building

### Web App
```bash
pnpm build
```
Builds a normal Next.js server app (with the `/api/snippets` routes) into `.next/`. Run it with `pnpm start`.

### Desktop App
```bash
pnpm tauri:build
```
This runs `pnpm build:tauri`, which produces a static export in `out/` (the API routes are excluded, since the desktop app talks to the Rust commands in `src-tauri` instead).
The built app will be in `src-tauri/target/release/bundle/`:
- **macOS**: `.dmg` and `.app`
- **Windows**: `.msi` and `.exe`
- **Linux**: `.deb`, `.AppImage`, and `.rpm`

## Data Storage

- **Web App**: Data is stored in a SQLite database at `./data/snippets.db`
- **Desktop App**: Data is stored in the user's local data directory:
  - **macOS**: `~/Library/Application Support/snipvault/snippets.db`
  - **Windows**: `C:\Users\<User>\AppData\Local\snipvault\snippets.db`
  - **Linux**: `~/.local/share/snipvault/snippets.db`

## Features

- Create, edit, and delete code snippets
- Syntax highlighting for 30+ languages
- Tag support with search and filtering
- Light/dark theme toggle
- Fast SQLite-backed storage
