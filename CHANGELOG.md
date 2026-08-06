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

[Unreleased]: https://github.com/FranciszekRyszka/Snippet-Vault/compare/v2.3.2...HEAD
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
