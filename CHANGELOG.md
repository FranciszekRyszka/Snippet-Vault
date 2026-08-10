# Changelog

All notable changes to SnipVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version corresponds to a `v*` git tag and a GitHub Release with
signed desktop installers and an updater `latest.json`. Going forward, every new
feature, change, fix, or security update should be added here — under
`[Unreleased]` while in progress, then moved into a dated version section when it
ships.

## [Unreleased]

## [2.14.0] — 2026-08-10

### Added
- **Multi-select bulk actions.** A new **Select** toggle (next to Views / Sort)
  turns on selection mode: tick the checkbox on any entries and act on them all
  at once from the bottom action bar — **Pin / Unpin**, set kind to **Prompt** or
  **Code**, **Export** the selection to a single JSON file, or **Delete** (a
  two-step confirm; deleted entries move to Trash and can be restored). **Select
  all** grabs everything currently visible, and **Esc** leaves selection mode.
  Bulk kind changes go through the normal edit path, so each still records a
  version in the entry's history.

## [2.13.0] — 2026-08-10

### Added
- **Markdown preview for prompts.** The detail view now has a **Raw / Preview**
  toggle for prompts: **Preview** renders the body as Markdown — headings, bold
  and italic, inline and fenced code, links, blockquotes, ordered and unordered
  lists, and horizontal rules. Raw stays the default (with its Copy button and
  syntax highlighting), and code snippets are unaffected. The renderer is
  built-in and safe by construction — it parses to a fixed set of elements and
  never injects HTML, and link targets are restricted to `http(s)`/`mailto`, so
  untrusted or imported prompt text can't smuggle in markup or scripts.

## [2.12.0] — 2026-08-10

### Added
- **Export as Markdown (.md).** The detail view now has a **.md** button that
  downloads the prompt as a Markdown file (heading + body, or a fenced code
  block for code snippets) — alongside the existing JSON export.
- **Keyboard navigation.** Use **j / k** (or ↑ / ↓) to move the highlight
  through the grid or list, and **Enter** to open the highlighted entry. (`/`
  still jumps to search, Ctrl/⌘-K opens the command palette.)
- **Hover preview.** In the compact list view, hovering an entry's title shows
  a quick peek — its description and the start of the body — without opening it.

## [2.11.0] — 2026-08-10

### Added
- **Empty Trash & Restore all.** The Trash view now has **Restore all** (brings
  back every deleted prompt at once) and **Empty trash** (permanently clears the
  deleted content). Emptying is sync-safe: it blanks each entry's content but
  keeps the deletion tombstone, so an emptied prompt can't be resurrected by
  another device on the next sync — and the emptied state propagates too.

## [2.10.0] — 2026-08-09

### Added
- **Saved searches (views).** Save the current filter combo — search, language,
  tag, kind, sort, favourites, model — under a name from the new **Views**
  dropdown, then re-apply it in one click. Views are stored locally per install.
- **Accent themes.** A palette button in the header lets you switch the app's
  accent colour (blue, violet, emerald, rose, orange, teal). Your choice is
  remembered and applied instantly, in both light and dark mode.

## [2.9.0] — 2026-08-09

### Added
- **Duplicate a prompt.** A new **Duplicate** action (on each card and in the
  detail view) forks a prompt into a fresh entry titled "… (copy)" — its own
  independent copy to use as a starting point for a variant. It gets a new
  identity and its own history.
- **Usage insights.** A new insights panel (chart icon in the header) summarizes
  your library: total prompts and copies, plus **most used**, **recently used**,
  and **never used** lists — surfacing the copy counts and last-used times the
  app already tracks. Click any entry to open it.
- **Drag-and-drop import.** Drop files anywhere on the window to import them —
  JSON exports merge as before (a whole library merges by id; single/multiple
  prompts are created), and `.md` / `.txt` files each become a new prompt (the
  filename is the title). You can also now select **multiple files** at once in
  the Import picker.
- **Copy as Markdown.** A new action in the detail view copies a prompt as a
  Markdown heading + body, or a code snippet as a language-tagged fenced code
  block — ready to paste into docs, issues, or chat.

## [2.8.0] — 2026-08-09

### Added
- **Diff view in prompt history.** Expanding a past version in the **History**
  section now shows a line-by-line **diff against the current version** (removed
  lines in red, added in green) with a compact `+N −M` summary — so you can see
  exactly what changed before restoring. A **Full text** toggle shows the raw
  version instead.

## [2.7.0] — 2026-08-09

### Added
- **Prompt history (versioning).** Every edit now records the previous version,
  so you can look back and roll forward. The detail view has a new **History**
  section listing past versions with their save time — expand one to preview it,
  or **Restore** to bring it back (restoring is itself an edit, so nothing is
  lost). No-op saves don't add history, and the newest ~50 versions per prompt
  are kept. History is stored locally in each database and is **not synced**, so
  the newest-wins sync model is unchanged.

## [2.6.0] — 2026-08-09

### Added
- **Whole-database backup & restore (desktop).** Settings now has a **Backups
  folder** — a stable, documented location holding timestamped snapshots of your
  entire database, each written with SQLite's online backup API so it's a
  consistent copy even while the app is running (never a torn mid-write file).
  Point an external backup tool (Databasus, restic, Time Machine, a cloud-sync
  folder, cron…) at that folder. **Back up now** writes a snapshot (the newest
  are kept, older ones pruned), **Open folder** reveals it in the file manager,
  and **Restore…** replaces your current library from a chosen backup — the file
  is validated as a SnipVault database first, so an unrelated or corrupt file
  can't clobber your data. An opt-in **"back up on launch"** toggle writes a
  snapshot automatically (at most once a day). The self-hosted **server** can be
  backed up the same way — see `docs/self-hosting.md` ("Backing up the server")
  and the commented **`backup`** sidecar in `docker-compose.yml`.

### Security
- **Sync token moved to the OS credential store.** On the desktop the sync
  server's access token is now kept in the operating system's secure store
  (Windows Credential Manager / macOS Keychain / Linux Secret Service) instead of
  in plaintext in `config.json`, which now holds only the server URL. An existing
  plaintext token is migrated into the secure store automatically on first launch
  and blanked from the file. If no secure store is available (e.g. a headless
  Linux box), the token falls back to `config.json` so sync keeps working.

## [2.5.0] — 2026-08-09

### Added
- **Command palette (Cmd/Ctrl-K).** A quick launcher to fuzzy-search your whole
  library by title, tag, language, or model and copy an entry without opening the
  full view. Selecting a prompt that has `{{variables}}` opens the fill-in dialog
  first, just like copying from a card. (Ctrl/⌘-K now opens the palette; press
  `/` to jump to the search box.)
- **Kind quick-filter.** An **All / Prompts / Code** segmented control with live
  counts, to narrow the grid to one entry type at a glance.
- **Sort options.** Sort the library by **Newest** (default), **Most used**,
  **Recently used**, or **A–Z**. Pinned entries still lead every order. Applied
  identically on the desktop and web/server backends.

### Changed
- **Prompt variables now remember their last-used values.** The fill-in dialog
  pre-fills each `{{variable}}` with what you entered last time for that prompt
  (stored locally per entry), so re-running a prompt is faster.

### Security
- Waived three newly-disclosed **build-time-only** advisories in the CSS
  toolchain (`postcss` and `nanoid`, reachable only via the build-time CSS
  pipeline — never at runtime) so `pnpm audit --prod` passes again. The audit
  now also re-runs when `pnpm-workspace.yaml` (where the waivers live) changes.
  Runtime-reachable dependencies remain un-waived and still fail CI.

## [2.4.0] — 2026-08-09

### Added
- **Trash (recently deleted).** A new Trash button in the header lists entries
  you've deleted and lets you **restore** any of them — deletes were already
  soft (kept as tombstones so they sync), and this surfaces them as a safety
  net. Restoring reuses the same undelete path as undo, so it syncs cleanly
  without creating duplicates.
- **Prompt variables.** Prompts can now contain `{{placeholders}}` (e.g.
  `{{topic}}`, `{{tone}}`). Copying such a prompt opens a small **fill-in dialog**
  — one field per variable with a live preview — and copies the completed text.
  Variable-free prompts copy in one click as before, and code snippets keep their
  literal braces untouched. A badge shows how many variables a prompt has.
- **Whole-library export & smarter import.** A new export button downloads your
  entire library as a single JSON file (`snipvault-library-<date>.json`).
  Importing that file **merges by entry id** — re-importing updates existing
  entries in place (newest edit wins) instead of creating duplicates — while
  importing single/multiple exported prompts works as before. A clean backup and
  transfer story that round-trips losslessly.
- **Sync status indicator.** When a sync server is configured, the header now
  shows a live indicator — a spinner while syncing, the time since the last
  successful sync ("Synced 2m ago", remembered across launches), or a "Sync
  failed" state with the error on hover. Clicking it syncs immediately. Syncs
  started from Settings or first-run setup update the same indicator.
- **Automated test suite + CI.** vitest unit tests for the API validators
  (`lib/api-utils.ts`) and a dependency-free `node:test` HTTP integration suite
  that exercises the sync-server API (auth gate, CRUD, and the newest-wins sync
  merge) against a throwaway database. A new **Tests** GitHub Actions workflow
  runs both on every push and pull request, complementing the Rust tests and the
  security audit. Run locally with `pnpm test`.

### Changed
- The self-hosted server's database location can now be overridden with the
  **`SNIPVAULT_DB_PATH`** environment variable (defaults to `./data/snippets.db`
  as before) — useful for placing the file on a specific volume, and used by the
  test harness to run against a disposable database.

## [2.3.3] — 2026-08-07

### Changed
- **Download/import toasts** are easier to spot and no longer clobber each
  other:
  - They now use a **distinct solid color** (emerald for confirmations, rose for
    errors) instead of blending into the app's card/background.
  - The download confirmation now says **where the file went** — "…to your
    Downloads folder (filename.json)".
  - Toasts **stack up to three** (newest at the bottom); exporting several
    prompts in a row shows each one, and a fourth evicts the oldest.

## [2.3.2] — 2026-08-06

### Changed
- The **download/export confirmation** ("Downloaded prompt/snippet …") now
  appears as a rounded popup **pinned to the bottom-center of the screen**,
  instead of an inline banner at the top of the page. Import confirmations use
  the same bottom popup.
- **Sync server:** the root URL now serves a small **status page** instead of
  the full web UI when a `SNIPVAULT_TOKEN` is set. On a token-protected server
  the browser UI can't authenticate (there's no place to enter the token), so it
  would only render a dead shell; the status page makes the endpoint's purpose
  clear. Servers run without a token (local dev, or an intentionally open web
  app via `SNIPVAULT_ALLOW_NO_AUTH=1`) still serve the full app. Server-only
  change; the desktop app is unaffected.

## [2.3.1] — 2026-07-26

### Changed
- The header's create button now reads **"New Prompt/Snippet"** (was "New
  Prompt"), reflecting that entries can be either.

### Added
- **Download confirmation** when exporting a single prompt/snippet — a short
  toast ("Downloaded prompt/snippet …") now appears so it's clear the file
  saved, instead of exporting silently.

## [2.3.0] — 2026-07-26

### Added
- **Entry kind: prompt vs. code snippet.** Each entry can now be marked as a
  *prompt* or a *code snippet* in the add/edit form. Code snippets show a small
  "Code" badge in the card and detail views.

### Changed
- The approximate **token estimate is now hidden for code snippets** (in the
  form, card, and detail views), where it isn't meaningful. Character and word
  counts still show for both kinds.

### Notes
- `kind` is a new sync-safe column defaulting to `prompt`. Existing entries and
  older sync peers are treated as prompts automatically — no data migration and
  no sync-protocol change. Self-hosted servers can be updated at any time; the
  feature is backward compatible either way.

## [2.2.2] — 2026-07-25

### Security
- Hardened the self-hosted sync server and desktop sync: request size/record
  caps on the sync endpoint, incoming-record sanitization on both ends
  (bounding field sizes and rejecting bogus timestamps that could poison the
  newest-wins merge), and a stricter production token gate.
- Updated the CI security-audit workflow to waive only build-time/transitive
  advisories, keeping runtime dependency checks meaningful.

## [2.2.1] — 2026-07-24

### Fixed
- Desktop sync now works with servers on **non-default ports** (the HTTP
  capability scope previously blocked them).
- Several **self-hosting fixes**: the container no longer crash-loops, starts
  Next.js directly, ships a health check and log-viewer-friendly logging, and
  `docker-compose` defaults to the published GHCR image with clearer token
  guidance.

## [2.2.0] — 2026-07-24

### Added
- **Two-way incremental sync** between the desktop app and a self-hosted server,
  using stable per-record UUIDs and soft-delete tombstones so edits and
  deletions converge across machines (most-recent-edit-wins per record).

## [2.1.0] — 2026-07-23

### Added
- **Self-hosted sync server** and a desktop **remote mode** to reconcile a
  library against it.

## [2.0.2] — 2026-07-10

### Added
- Let users **choose the new database location** during first-run setup.

## [2.0.1] — 2026-07-04

### Fixed
- Fixed 33 audited bugs and hardened runtime parity between the web and desktop
  backends and their error handling.

## [2.0.0] — 2026-07-03

### Added
- **Token counts** and length stats per prompt.
- **Model / target metadata** on entries, with filtering.
- **Favorites filter**, **undo-after-delete**, and **usage tracking**
  (copy counts and last-used time).
- **List and detail views** for browsing the library.

## [1.5.0] — 2026-07-03

### Added
- **Favorites** (pinning), **prompt import**, and **single-prompt export**.

## [1.4.1] — 2026-07-03

### Security
- General security hardening.

## [1.4.0] — 2026-07-02

### Added
- **In-app auto-updater** for the desktop app (signed updates).

## [1.3.0] — 2026-07-02

### Added
- **Copy button**, **keyboard shortcuts**, and **library stats**.

## [1.2.0] — 2026-07-01

### Added
- **First-run database setup** and **database backup** (desktop).

## [1.1.0] — 2026-07-01

### Added
- **Tag autocomplete** with suggestions from existing tags.

## [1.0.0] — 2026-06-14

### Added
- Initial release: a local-first prompt/snippet vault with tags, language and
  syntax highlighting, and search — available as a Tauri desktop app and a
  Next.js web app over a shared SQLite schema.

[Unreleased]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.14.0...HEAD
[2.14.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.13.0...v2.14.0
[2.13.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.11.0...v2.12.0
[2.11.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.10.0...v2.11.0
[2.10.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.9.0...v2.10.0
[2.9.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.7.0...v2.8.0
[2.7.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.6.0...v2.7.0
[2.6.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.3.3...v2.4.0
[2.3.3]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.3.2...v2.3.3
[2.3.2]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.3.1...v2.3.2
[2.3.1]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.2.2...v2.3.0
[2.2.2]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.2.1...v2.2.2
[2.2.1]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.0.2...v2.1.0
[2.0.2]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.5.0...v2.0.0
[1.5.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/FranciszekRyszka/Snippet-Vault/releases/tag/v1.0.0
