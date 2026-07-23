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
- 🎨 Syntax highlighting for 35 languages (powered by highlight.js)
- 🏷️ Tag support with autocomplete, search, and filtering
- 📋 **One-click copy** of any snippet to the clipboard
- ⌨️ **Keyboard shortcuts** — new prompt (Ctrl/⌘+N), focus search (Ctrl/⌘+K or `/`), close dialogs (Esc)
- 📊 **Library stats** — total prompts, languages, and tags at a glance
- 🌗 Light / dark theme toggle (follows system by default)
- ⚡ Fast, local SQLite storage
- 🗄️ **Choose your database location** on first launch — create a new one or use an existing `snippets.db` (e.g. in a synced folder) *(desktop)*
- 💾 **One-click database backup** from Settings *(desktop)*
- 🔄 **Built-in auto-update** — the app checks GitHub for new versions and updates itself in place (your database is untouched); automatic startup checks can be turned off *(desktop)*
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

- [Node.js](https://nodejs.org/) 22+ and [pnpm](https://pnpm.io/) 11
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

> **Web mode is single-user and local-only.** The `/api/snippets` routes have no authentication, so the dev and start servers bind to `127.0.0.1` (loopback) and are not reachable from other machines. Don't expose this to a network; if you deliberately need LAN access, override the host (e.g. `next start -H 0.0.0.0`) and put it behind your own auth/proxy.

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
- **Desktop app** — configurable. On first launch you choose to create a new database or use an existing `snippets.db`; the location is remembered in a `config.json` and can be changed later in **Settings**. The default location is the OS local data directory:
  - **macOS**: `~/Library/Application Support/snipvault/snippets.db`
  - **Windows**: `C:\Users\<User>\AppData\Local\snipvault\snippets.db`
  - **Linux**: `~/.local/share/snipvault/snippets.db`

  You can back up the database at any time from **Settings → Back up database**.

## Sync across computers

Run SnipVault on a machine on your network (a homeserver, NAS, or spare PC) and
point every desktop app at it to share **one library** across all your
computers. Access is protected by a bearer token you choose.

Quick start with Docker:

```bash
cp .env.example .env   # set a strong SNIPVAULT_TOKEN
docker compose up -d
```

Then in each app: **Settings → Sync server → Test & connect** (or choose
**Connect to a sync server** on first launch), entering the server URL and
token. Full instructions — including a bare Node + systemd setup and security
notes — are in [`docs/self-hosting.md`](docs/self-hosting.md).

## macOS: "SnipVault is damaged and can't be opened"

SnipVault is **not signed with a paid Apple Developer certificate**, so when you download the `.dmg` from the Releases page, macOS Gatekeeper quarantines it and — on Apple Silicon especially — shows *"SnipVault is damaged and can't be opened. You should move it to the Trash."* The app is not actually damaged; this is Gatekeeper blocking an unsigned, un-notarized app. To open it:

1. Open the `.dmg` and drag **SnipVault.app** into your **Applications** folder.
2. Open **Terminal** and run:

   ```bash
   xattr -dr com.apple.quarantine /Applications/SnipVault.app
   ```

3. Launch SnipVault from Applications as normal.

You only need to do this once per install. Choose the **aarch64** `.dmg` for Apple Silicon (M1–M4) Macs, or the **x64** `.dmg` for Intel Macs.

> A permanent fix (no Terminal step for users) requires signing and notarizing the app with an Apple Developer ID, which needs a paid Apple Developer Program membership.

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
