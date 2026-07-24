# SnipVault — Bug Hunt & Fix Plan

Adversarial multi-reviewer audit of the v2.0.0 codebase (Next.js web runtime + Tauri/Rust
desktop runtime over a shared `snippets.db`). Four reviewers fanned out across the frontend,
the web API routes, the Rust backend, and the cross-cutting parity layer; every finding below
was re-verified against the source by hand. Findings that failed verification were dropped.

The single largest theme is **runtime parity drift**: the web API validates input, the Rust
backend validates nothing, and the two search/filter implementations diverge. The second theme
is a **silent-failure error contract** in the web `tauri-api` layer (`return res.ok` / `return
null` instead of throwing) that the dashboard treats as success.

Severity key: **Critical** = data loss/corruption or list-wide breakage reachable in normal use;
**High** = data loss/duplication or broken core flow under realistic conditions; **Medium** =
wrong results, silent failures, or single-runtime breakage; **Low** = cosmetic, edge-case, or
defense-in-depth.

---

## ✅ Implementation status — ALL 33 findings fixed

Every finding below has been implemented on the working tree. `npx tsc --noEmit` passes (exit 0)
and `cargo check` compiles clean. `line:` references point at the **original** (pre-fix) source.

**New files added**
- `src-tauri/src/validation.rs` — Rust write-path validation/normalization (S1).
- `lib/api-utils.ts` — shared web helpers: `escapeLike`, `sanitizeTags`, `sanitizeModel`,
  `parseId`, `validTimestampOr` (S2/S4/M8/L3, deduped across the three route files).

**Files changed:** `src-tauri/Cargo.toml` (added the rusqlite `functions` feature for the Unicode
`ulower`), `lib/tauri-api.ts`, `lib/db.ts`, `lib/updater.ts`, `lib/prompt-stats.ts`,
`app/api/snippets/route.ts`, `app/api/snippets/[id]/route.ts`, `app/api/snippets/[id]/copy/route.ts`,
`app/api/snippets/restore/route.ts`, `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`,
`components/snippets-dashboard.tsx`, `components/code-block.tsx`, `components/snippet-card.tsx`,
`components/snippet-detail.tsx`, `components/snippet-form.tsx`, `components/header.tsx`,
`components/settings-dialog.tsx`, `components/update-banner.tsx`, `components/highlight-theme.tsx`,
`scripts/build-tauri.mjs`.

**Follow-up not done (noted, not required by the plan):** unit tests asserting web and Rust store
identical rows for identical input — see the closing note.

---

## Shared fixes (landed first — they resolve or de-risk many findings at once)

- **S1. Rust validation module — ✅ Done.** Added `src-tauri/src/validation.rs` mirroring the web
  rules: title required + ≤255 chars, `language` against the same 34-value whitelist as
  `lib/languages.ts`, tags `trim → lowercase → filter → dedupe → cap 20`, model `trim → cap 100`,
  plus restore-only guards (non-negative integer `copy_count`, ISO-validated timestamps). Wired
  into `create_snippet` / `update_snippet` / `restore_snippet` in `lib.rs`. Closes C1, H3-adjacent,
  M4, M5.
- **S2. LIKE-escape helper (both runtimes) — ✅ Done.** `escape_like` in `db.rs` and `escapeLike`
  in `lib/api-utils.ts`, each escaping `% _ \` with an `ESCAPE '\'` clause on every tag/search
  `LIKE`. Closes H4's injection half and L1.
- **S3. API error contract — ✅ Done.** Added `throwIfNotOk` in `lib/tauri-api.ts`; the web
  branches of `updateSnippet`/`deleteSnippet`/`setFavorite`/`restoreSnippet` now throw the server's
  error message instead of returning `null`/`res.ok`. (`createSnippet`/`getSnippets` already threw;
  `recordCopy` stays intentionally fire-and-forget.) The dashboard now surfaces these via a
  dismissible error toast. Closes H1, M1, M2 (with dashboard changes).
- **S4. restore-route hardening — ✅ Done.** The web restore route runs its body through
  `sanitizeTags`/`sanitizeModel`, coerces `copy_count` to a non-negative **integer**
  (`Math.max(0, Math.floor(...))`), requires `favorite === true`, and validates timestamps to the
  stored format (else `now`). The Rust side does the same via `validation::sanitize_restore`.
  Closes C2, M4, L2.

---

## CRITICAL

### C1 — Rust backend enforces zero validation (parity break, reachable today)
- **Where:** `src-tauri/src/db.rs` (`create_snippet`/`update_snippet`), `src-tauri/src/lib.rs`.
- **What:** No title-length, language-whitelist, tag-normalize/cap, or model-cap checks. Reachable
  today: JSON import on desktop only type-filtered tags and sliced `title`, so a desktop row could
  hold an invalid `language`/500 tags that the web PUT then rejects (400) — un-editable per runtime.
- **Status:** ✅ **Fixed.** S1 validates all three write commands. The import path
  (`snippets-dashboard.tsx`) now normalizes `title`, `model`, **and** `tags` before calling
  `createSnippet`, so desktop imports can't store rows the web app would reject.

### C2 — Fractional `copy_count` via restore breaks the entire desktop list
- **Where:** `app/api/snippets/restore/route.ts` (`Number.isFinite(copy_count)` accepted `1.5`) →
  REAL in an INTEGER column → `db.rs` `row.get::<_, i64>` returns `InvalidColumnType` → because
  `get_all_snippets` reads every row into one struct, the **whole desktop list** errors out.
- **Status:** ✅ **Fixed.** S4 coerces `copy_count` to a non-negative integer at the restore route.
  Defense-in-depth: `row_to_snippet` now reads `copy_count` as i64 with an `f64`→i64 fallback, so a
  single odd row can't error the list.

---

## HIGH

### H1 — Silent DELETE failure shows Undo toast → duplicate row on Undo
- **Where:** `lib/tauri-api.ts` (`deleteSnippet` did `return res.ok`, never threw),
  `components/snippets-dashboard.tsx` (`handleDelete` discarded the result; `catch` only fired on a
  network throw). A failed delete still showed "Undo" → `restoreSnippet` inserted a **duplicate**;
  without Undo the row **resurrected** on refetch.
- **Status:** ✅ **Fixed.** S3 makes `deleteSnippet` throw on `!res.ok`. `handleDelete`'s `catch`
  now clears the pending Undo, shows an error toast, and refetches so the optimistically-removed
  row comes back rather than becoming a duplicate.

### H2 — Import aborts on first server rejection, hides progress, misleads the user
- **Where:** `components/snippets-dashboard.tsx` import loop — no per-item `try/catch`; the shape
  check didn't skip empty-string titles (which 400 on web); the outer `catch` skipped the refetch
  and blamed the file's validity.
- **Status:** ✅ **Fixed.** Rewritten to import each item in its own `try/catch`, tally
  `{imported, skipped}`, skip items without a non-empty title/code, and **always** refetch in a
  `finally`. The notice reports the counts; the "invalid JSON" message is reserved for an actual
  parse failure.

### H3 — Backing up the database onto its own live file → vault corruption
- **Where:** `src-tauri/src/lib.rs` `backup_database` called `db.backup_to(&dest)` with no
  `dest != db.path()` guard; the save dialog let the user pick the live `snippets.db`.
- **Status:** ✅ **Fixed.** `backup_database` now compares canonicalized destination and live paths
  (falling back to raw comparison when the destination doesn't exist yet) and returns a clear error
  instead of overwriting the source.

### H4 — Tag-filter results differ between desktop and web (same data, same click)
- **Where:** `src-tauri/src/db.rs` built `format!("%\"{}%", t)` — **missing the closing quote** →
  prefix match (`rust` matched `rustacean`) — vs the web route's exact `%"tag"%`.
- **Status:** ✅ **Fixed.** Rust now builds `format!("%\"{}\"%", escape_like(t))` with an
  `ESCAPE '\'` clause, matching the web route exactly.

### H5 — `fetchSnippets` has no sequence/abort guard → stale search overwrites fresh
- **Where:** `components/snippets-dashboard.tsx` — no request id; a slow earlier response could
  overwrite a newer one.
- **Status:** ✅ **Fixed.** Added a monotonic `fetchSeq` ref; each call captures its sequence
  number and ignores its response (and its loading/error state changes) if a newer fetch has
  started. This also narrows M13's window (latest fetch always wins).

---

## MEDIUM

### M1 — `updateSnippet` null-on-error treated as success (silent lost edit)
- **Where:** `lib/tauri-api.ts` (`if (!res.ok) return null`), `snippets-dashboard.tsx` `handleSave`.
- **Status:** ✅ **Fixed.** S3 makes the web branch throw; `handleSave` treats a thrown error (and a
  desktop `null` = "no longer exists") as failure, keeps the form open, and shows the error. Create
  failures are surfaced the same way rather than only `console.error`.

### M2 — Undo failure is silent and unrecoverable
- **Where:** `lib/tauri-api.ts` (web returned `null`), `snippets-dashboard.tsx` `handleUndo`
  cleared `pendingUndo` before awaiting.
- **Status:** ✅ **Fixed.** `restoreSnippet` throws on failure (S3); `handleUndo`'s `catch` shows an
  error and **re-offers Undo** (re-sets `pendingUndo` + timer) so the deletion isn't lost silently.

### M3 — Second delete within the undo window silently clobbers the first
- **Where:** `snippets-dashboard.tsx` — single `pendingUndo` slot; toast didn't name the target.
- **Status:** ✅ **Fixed (flush + name).** The toast now names the deleted prompt
  (`Deleted "<title>"`). The single-slot model is retained deliberately — a new delete flushes the
  previous (already server-side deleted) one, which is the accepted "flush the previous immediately"
  option from the plan.

### M4 — restore route: no title/model cap, unvalidated tag items
- **Where:** `app/api/snippets/restore/route.ts`.
- **Status:** ✅ **Fixed** via S4 (title 255 cap, `sanitizeModel`, `sanitizeTags` with per-item
  string filtering + dedupe + cap).

### M5 — `restore_snippet` (Rust) is fully unvalidated
- **Where:** `src-tauri/src/db.rs` `restore_snippet`.
- **Status:** ✅ **Fixed.** `validation::sanitize_restore` runs before insert: core field validation,
  tag/model normalization, `copy_count.clamp(0, i64::MAX - 1)` (prevents the overflow-to-REAL that
  would later break reads), and timestamp validation (bogus values fall back to `now`).

### M6 — Desktop non-ASCII search returns nothing
- **Where:** `src-tauri/src/db.rs` — Rust `s.to_lowercase()` (Unicode) vs SQLite `LOWER()` (ASCII).
- **Status:** ✅ **Fixed.** Registered a Unicode-aware `ulower` scalar function (rusqlite
  `functions` feature) and switched every search predicate to `ulower(col) LIKE ?`, so both the
  needle and the columns fold identically. `Übersetzung` now matches on the desktop.

### M7 — Migration errors swallowed → whole session errors "no such column"
- **Where:** `src-tauri/src/db.rs` (`let _ = conn.execute("ALTER TABLE …")`); no `busy_timeout`.
- **Status:** ✅ **Fixed.** `open()` now sets a 5s `busy_timeout` and gates each `ALTER` on a
  `PRAGMA table_info` column set (mirroring the web migration), so a genuine failure propagates
  instead of being masked.

### M8 — `parseInt(id)` truncation on web id routes
- **Where:** `app/api/snippets/[id]/route.ts`, `.../[id]/copy/route.ts`.
- **Status:** ✅ **Fixed.** All four handlers use `parseId` (`/^\d+$/`) and return 400 on a
  non-integer id, matching the desktop's i64 rejection.

### M9 — Unguarded `JSON.parse` in `rowToSnippet` 500s the entire web list
- **Where:** `lib/db.ts`.
- **Status:** ✅ **Fixed.** A `parseTags` helper wraps the parse in `try/catch`, returns `[]` on
  malformed data, and filters to strings — one bad cell no longer 500s the list.

### M10 — `hljs.highlightElement` clobbers the React-owned text node → stale code
- **Where:** `components/code-block.tsx`.
- **Status:** ✅ **Fixed.** The `<code>` element is rendered empty (no JSX child); the effect sets
  `el.textContent = code` before highlighting, so the effect fully owns the content and every render
  stays in sync with the latest `code`.

### M11 — Failed Tauri build leaves the web app broken
- **Where:** `scripts/build-tauri.mjs` — `process.exit` inside `try` skipped the `finally` restore.
- **Status:** ✅ **Fixed.** The failure is recorded in an `exitCode` variable; `process.exit`
  happens **after** the `finally` restores `app/api`.

### M12 — Two update handles allow a concurrent double-install
- **Where:** banner + Settings each hold an independent `AvailableUpdate`.
- **Status:** ✅ **Fixed.** A module-level `installInProgress` guard in `lib/updater.ts` rejects a
  second `install()` while one is running (reset on error to allow retry; left set on success since
  the app relaunches). Spans every handle regardless of which UI triggered it.

### M13 — Refetch racing an in-flight DELETE re-adds the deleted row
- **Where:** `snippets-dashboard.tsx`.
- **What:** H5's `fetchSeq` guard alone does **not** cover this: the racing refetch (e.g.
  toggle-favorite → delete) is still the *latest* fetch, so its stale result would be applied and
  re-add the row.
- **Status:** ✅ **Fixed.** Added a `pendingDeletes` ref (Set of ids). `handleDelete` adds the id on
  optimistic removal; `fetchSnippets`/`fetchAllSnippets` filter those ids out of every result via
  `dropPendingDeletes`, so an in-flight fetch can't re-add a just-deleted row. The id is removed
  again only if the delete fails (then a refetch restores the row). Ids are never reused
  (`AUTOINCREMENT`), so leaving a committed id in the set is harmless.

---

## LOW

- **L1 — LIKE `%`/`_` unescaped (both runtimes).** ✅ Fixed by **S2** (`escape_like`/`escapeLike`
  + `ESCAPE '\'`).
- **L2 — restore route truthiness/timestamps.** ✅ Fixed by **S4** (`favorite === true`;
  `validTimestampOr` rejects bogus `created_at`/`updated_at`/`last_used_at`).
- **L3 — non-string tag → 500; tags never deduped on POST.** ✅ Fixed. `sanitizeTags`
  (`lib/api-utils.ts`) skips non-strings and dedupes; used by POST, PUT, and restore.
- **L4 — clipboard writes have no `catch`.** ✅ Fixed in `code-block.tsx`, `snippet-card.tsx`,
  `snippet-detail.tsx` — each wraps the write in `try/catch` and does **not** show a false "copied"
  state on failure.
- **L5 — unguarded `localStorage.getItem`.** ✅ Fixed — the view-preference read is wrapped in
  `try/catch`.
- **L6 — untracked timers.** ✅ Fixed — `importNotice`/error toasts use tracked refs
  (`importTimer`, `errorTimer`) cleared on re-fire and on unmount.
- **L7 — latent abort-class panics.** ✅ Fixed (the concrete ones): the two
  `get_snippet(id).map(|s| s.unwrap())` sites in `create_snippet`/`restore_snippet` now use
  `?.ok_or_else(|| QueryReturnedNoRows)`. The `conn.lock().unwrap()` calls are left as-is —
  documented as safe (the `AppState` mutex serializes all access, and `panic = "abort"` means a
  lock can't actually be poisoned).
- **L8 — theme toggle reads `theme` not `resolvedTheme`.** ✅ Fixed in `components/header.tsx` —
  both the icon and the toggle target use `resolvedTheme`.
- **L9 — `handleSubmit` has no `saving` guard → double-submit duplicate.** ✅ Fixed — early
  `if (saving) return;` in `components/snippet-form.tsx`.
- **L10 — trailing `tagInput` bypasses the 20-tag cap.** ✅ Fixed — `finalTags` re-applies
  `.slice(0, 20)` (and S1 enforces it backend-side).
- **L11 — `relaunchApp()` floating promise.** ✅ Fixed — both the banner and Settings call a
  `handleRelaunch` that awaits and surfaces a failure ("installed, but restart failed…").
- **L12 — `prompt-stats` character count is UTF-16 units.** ✅ Fixed — `chars = [...text].length`
  counts code points.
- **L13 — highlight stylesheet FOUC.** ✅ Fixed — `highlight-theme.tsx` drops the mount gate
  (defaults to the light sheet so SSR and first client render agree) and preloads both themes so a
  light/dark toggle has no unstyled gap.

---

## Verified NON-issues (were not re-opened)

PATCH `favorite` is correctly type-checked; copy increment is atomic and 404s on 0 changes; **all
SQL is parameterized** (the LIKE-wildcard item L1 was the only injection-adjacent gap, now closed);
detail-view delete closes cleanly and undo-timer/Esc cleanup is correct; `exportSnippet` slug is
safe; `tags || []` guards are present on read paths; every `invoke()` arg name matches its Rust
command under Tauri v2's camelCase→snake_case conversion; the update check is desktop-gated; the
tag-input Enter handler `preventDefault`s; `data/` is tracked via `.gitkeep`.

---

## Execution order (as implemented)

1. ✅ **S3** (API error contract) + dashboard callers — made silent failures visible (H1/M1/M2).
2. ✅ **S1** (Rust validation) + backup guard **H3** — closed C1/M4/M5 and the biggest parity gap.
3. ✅ **H2** (import robustness).
4. ✅ **C2 + S4** (restore hardening) — closed the desktop-list-breakage vector.
5. ✅ **H4 + S2** (tag filter + LIKE escaping) and **H5** (fetch race).
6. ✅ Medium batch (M6–M13), then ✅ Low batch (L1–L13).

**Verification:** `npx tsc --noEmit` → exit 0; `cargo check` → clean. (`eslint .` fails
independently of this work — the repo ships no flat `eslint.config.js`, which ESLint 9+ requires;
it fails identically on a clean checkout.)

**Recommended follow-up (not done):** add tests asserting that the web routes and the Rust commands
produce **identical stored rows** for the same input. The shared helpers (`lib/api-utils.ts`,
`src-tauri/src/validation.rs`) are now structured to make that parity assertion straightforward —
it's the regression guard this codebase is still missing.
