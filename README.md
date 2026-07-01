# SnipVault

A code snippets library that runs as both a web app and a native cross-platform desktop app. Save, organize, and find your code snippets with syntax highlighting, tags, and fast SQLite-backed storage.

Built with **Next.js 16**, **React 19**, **Tauri 2**, and **shadcn/ui**.

## Documentation

📖 Full documentation is on the **[project Wiki](https://github.com/FranciszekRyszka/Snippet-Vault/wiki)**:

- [Installation](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Installation) · [User Guide](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/User-Guide)
- [Development Setup](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Development-Setup) · [Building and Packaging](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Building-and-Packaging) · [Architecture](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Architecture)
- [Data Storage](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Data-Storage) · [API and Commands](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/API-and-Commands)
- [Continuous Integration](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Continuous-Integration) · [Troubleshooting](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Troubleshooting) · [Contributing](https://github.com/FranciszekRyszka/Snippet-Vault/wiki/Contributing)

## Features

- 📝 Create, edit, and delete code snippets
- 🎨 Syntax highlighting for 30+ languages (powered by highlight.js)
- 🏷️ Tag support with search and filtering
- 🌗 Light / dark theme toggle (follows system by default)
- ⚡ Fast, local SQLite storage
- 🖥️ Runs in the browser or as a native desktop app (macOS, Windows, Linux)

## Tech Stack

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router), React 19 |
| Desktop shell | Tauri 2 (Rust) |
| UI | shadcn/ui, Radix UI, Tailwind CSS |
| Data | SQLite (`better-sqlite3` on web, `rusqlite` in Tauri) |
| Forms & validation | React Hook Form + Zod |
| Highlighting | highlight.js |

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- For the **desktop app** only:
  - [Rust](https://rustup.rs/)
  - **Windows**: [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) + [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)
  - **macOS**: `xcode-select --install`
  - **Linux**: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`

## Getting Started

```bash
pnpm install
```

### Web app (browser)

```bash
pnpm dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Desktop app (Tauri)

```bash
pnpm tauri:dev
```

This starts the Next.js dev server and opens the native Tauri window.

## Building

### Web app

```bash
pnpm build   # then: pnpm start
```

Builds a Next.js server app (including the `/api/snippets` routes) into `.next/`.

### Desktop app

```bash
pnpm tauri:build
```

Runs `pnpm build:tauri`, which produces a static export in `out/` (the API routes are excluded — the desktop app talks to the Rust commands in `src-tauri` instead). Bundles land in `src-tauri/target/release/bundle/`:

- **macOS** — `.dmg`, `.app`
- **Windows** — `.msi`, `.exe`
- **Linux** — `.deb`, `.AppImage`, `.rpm`

## Data Storage

- **Web app** — `./data/snippets.db`
- **Desktop app** — the OS local data directory:
  - **macOS**: `~/Library/Application Support/snipvault/snippets.db`
  - **Windows**: `C:\Users\<User>\AppData\Local\snipvault\snippets.db`
  - **Linux**: `~/.local/share/snipvault/snippets.db`

## Project Structure

```
app/            Next.js App Router pages and API routes
components/      React components (including shadcn/ui in components/ui)
hooks/          Custom React hooks
lib/            Database, Tauri API bridge, and utilities
scripts/        SQL migrations and the Tauri build script
src-tauri/      Rust source for the desktop app
```

See [TAURI_BUILD.md](./TAURI_BUILD.md) for detailed desktop build instructions.
