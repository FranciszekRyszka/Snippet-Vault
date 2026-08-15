use rusqlite::{Connection, DatabaseName, OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The full column list, in the order `row_to_snippet` expects. Kept in one
/// place so every SELECT stays in sync with the row mapper. New columns (`uuid`,
/// then `kind`) are appended last so the earlier indices stay stable.
const SNIPPET_COLUMNS: &str =
    "id, title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at, uuid, kind, color, template, last_device, collection, icon";

/// How many past revisions to keep per snippet. Older ones are pruned on each
/// new capture so history stays bounded.
const REVISION_KEEP: i64 = 50;

/// Escape LIKE metacharacters so user input matches literally. Must be paired
/// with an `ESCAPE '\'` clause on the LIKE. Without this, a search or tag value
/// containing `%` or `_` would act as a wildcard (e.g. `%` matches everything).
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

/// Whether the file at `path` looks like a SnipVault database: it opens as
/// SQLite and has a `snippets` table carrying the key columns we rely on. Used
/// to guard "restore from backup" so we never overwrite the live library with an
/// unrelated or corrupt file. Opens read-only and never mutates anything.
pub fn looks_like_snipvault_db(path: &Path) -> bool {
    use rusqlite::OpenFlags;
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return false;
    };
    let has_table = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='snippets'",
            [],
            |_| Ok(()),
        )
        .optional()
        .unwrap_or(None)
        .is_some();
    if !has_table {
        return false;
    }
    // The snippets table must carry the columns the app depends on.
    let mut cols = std::collections::HashSet::new();
    if let Ok(mut stmt) = conn.prepare("PRAGMA table_info(snippets)") {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) {
            for c in rows.flatten() {
                cols.insert(c);
            }
        }
    }
    ["title", "code", "language", "uuid", "deleted"]
        .iter()
        .all(|c| cols.contains(*c))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: i64,
    #[serde(default)]
    pub uuid: String,
    pub title: String,
    pub description: String,
    pub code: String,
    pub language: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub model: String,
    /// Entry kind: `"prompt"` (default) or `"code"`. Distinguishes a runnable
    /// prompt from a plain code snippet — the UI hides the token estimate for
    /// code, where it's meaningless.
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Per-prompt color tag (`""` = none) from a small fixed palette, purely for
    /// visual scanning. Metadata like `favorite` — not part of prompt history.
    #[serde(default)]
    pub color: String,
    /// Whether this entry is a reusable template (offered as a starting point in
    /// the New dialog). Metadata like `favorite` — not part of prompt history.
    #[serde(default)]
    pub template: bool,
    /// Friendly name of the device that last wrote this row ("" = unknown).
    /// Stamped by the desktop app on local writes; travels through sync so other
    /// devices can see where an edit came from.
    #[serde(default)]
    pub last_device: String,
    /// Collection (folder) this entry belongs to ("" = none). A single free-form
    /// label used to group the library; filtered client-side. Metadata like
    /// `favorite` — not part of prompt history.
    #[serde(default)]
    pub collection: String,
    /// Short display icon (an emoji, "" = none) shown before the title. Metadata
    /// like `favorite` — not part of prompt history.
    #[serde(default)]
    pub icon: String,
    pub copy_count: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Serde default for `kind` on records that predate the column (e.g. an older
/// sync peer that never sends it): treat them as prompts.
fn default_kind() -> String {
    "prompt".to_string()
}

/// A past version of a snippet, captured when it was edited. `saved_at` is the
/// `updated_at` the version carried while it was live (i.e. when it was saved).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnippetRevision {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub code: String,
    pub language: String,
    pub tags: Vec<String>,
    pub model: String,
    pub kind: String,
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSnippetInput {
    pub title: String,
    pub description: Option<String>,
    pub code: String,
    pub language: String,
    pub tags: Option<Vec<String>>,
    pub model: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub template: Option<bool>,
    #[serde(default)]
    pub collection: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSnippetInput {
    pub title: String,
    pub description: Option<String>,
    pub code: String,
    pub language: String,
    pub tags: Option<Vec<String>>,
    pub model: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub template: Option<bool>,
    #[serde(default)]
    pub collection: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

/// One snippet as it travels to/from the sync server: the full record keyed by
/// the stable `uuid`, including the `deleted` tombstone flag (so deletions
/// propagate) but no local autoincrement `id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRecord {
    pub uuid: String,
    pub title: String,
    pub description: String,
    pub code: String,
    pub language: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub model: String,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub template: bool,
    #[serde(default)]
    pub last_device: String,
    #[serde(default)]
    pub collection: String,
    #[serde(default)]
    pub icon: String,
    pub copy_count: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted: bool,
}

/// Map a row selected with `SNIPPET_COLUMNS` into a `Snippet`.
fn row_to_snippet(row: &rusqlite::Row) -> Result<Snippet> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let favorite: i64 = row.get(6)?;

    Ok(Snippet {
        id: row.get(0)?,
        title: row.get(1)?,
        // `uuid` is the last column (index 12). Tolerate NULL on a not-yet-
        // migrated row by falling back to an empty string.
        uuid: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        description: row.get(2)?,
        code: row.get(3)?,
        language: row.get(4)?,
        tags,
        favorite: favorite != 0,
        model: row.get(7)?,
        // `kind` is the last column (index 13). Tolerate NULL on a not-yet-
        // migrated row by falling back to "prompt".
        kind: row
            .get::<_, Option<String>>(13)?
            .unwrap_or_else(|| "prompt".to_string()),
        // `color` is at index 14. Tolerate NULL on a not-yet-migrated row by
        // falling back to "" (no color).
        color: row.get::<_, Option<String>>(14)?.unwrap_or_default(),
        // `template` is at index 15. Tolerate NULL by defaulting to false.
        template: row.get::<_, Option<i64>>(15)?.unwrap_or(0) != 0,
        // `last_device` is at index 16. Tolerate NULL → "".
        last_device: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
        // `collection` is at index 17. Tolerate NULL → "".
        collection: row.get::<_, Option<String>>(17)?.unwrap_or_default(),
        // `icon` is the last column (index 18). Tolerate NULL → "".
        icon: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
        // Read as i64, but fall back to a truncated REAL: SQLite's integer
        // arithmetic can overflow a copy_count into a float, and this column has
        // seen bad writes before. A defensive read keeps one odd row from
        // erroring the whole list.
        copy_count: row
            .get::<_, i64>(8)
            .or_else(|_| row.get::<_, f64>(8).map(|f| f as i64))?,
        last_used_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

/// Build a safe FTS5 MATCH query from raw user input. Splits on non-alphanumeric
/// runs into tokens, then quotes each as a prefix term (`"tok"*`) joined by
/// spaces (implicit AND). Quoting + the alphanumeric-only split means no FTS5
/// query-syntax character (`"`, `*`, `:`, `-`, `(`, `NEAR`…) can reach the parser,
/// so a hostile string can never cause an FTS syntax error or change the query
/// shape. Returns None when the input has no searchable tokens (e.g. "%%%"), so
/// the caller can decide that a non-empty search with no tokens matches nothing.
fn fts_match_query(s: &str) -> Option<String> {
    let terms: Vec<String> = s
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| format!("\"{}\"*", t))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
    /// This install's friendly name, stamped into `last_device` on local writes.
    /// Set from config after open (empty until then → rows get "" = unknown).
    device: Mutex<String>,
    /// Whether the FTS5 full-text index is available (it is in the bundled
    /// SQLite). If creating it ever fails, search falls back to LIKE.
    fts_enabled: bool,
}

/// Create the FTS5 index over the searchable columns and the triggers that keep
/// it in sync with the base table. Because the triggers live on `snippets`, every
/// write path — create/update/restore/sync-merge/purge — maintains the index for
/// free. On first creation the index is built from any existing rows. Returns Err
/// if FTS5 is unavailable in this build, so the caller can fall back to LIKE.
fn init_fts(conn: &Connection) -> Result<()> {
    let exists = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='snippets_fts'",
            [],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
            title, description, tags, model, code,
            content='snippets', content_rowid='id'
        );
        CREATE TRIGGER IF NOT EXISTS snippets_fts_ai AFTER INSERT ON snippets BEGIN
            INSERT INTO snippets_fts(rowid, title, description, tags, model, code)
            VALUES (new.id, new.title, new.description, new.tags, new.model, new.code);
        END;
        CREATE TRIGGER IF NOT EXISTS snippets_fts_ad AFTER DELETE ON snippets BEGIN
            INSERT INTO snippets_fts(snippets_fts, rowid, title, description, tags, model, code)
            VALUES('delete', old.id, old.title, old.description, old.tags, old.model, old.code);
        END;
        CREATE TRIGGER IF NOT EXISTS snippets_fts_au AFTER UPDATE ON snippets BEGIN
            INSERT INTO snippets_fts(snippets_fts, rowid, title, description, tags, model, code)
            VALUES('delete', old.id, old.title, old.description, old.tags, old.model, old.code);
            INSERT INTO snippets_fts(rowid, title, description, tags, model, code)
            VALUES (new.id, new.title, new.description, new.tags, new.model, new.code);
        END;",
    )?;
    if !exists {
        conn.execute("INSERT INTO snippets_fts(snippets_fts) VALUES('rebuild')", [])?;
    }
    Ok(())
}

impl Database {
    /// Open (or create) a SnipVault database at the given path.
    pub fn open(path: &Path) -> Result<Self> {
        // Ensure the parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(path)?;

        // Wait (rather than failing instantly) if another connection holds a
        // write lock — otherwise a transient SQLITE_BUSY during startup could
        // abort the migrations below and leave the schema half-upgraded.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;

        // A Unicode-aware lowercase, used for case-insensitive search. SQLite's
        // built-in LOWER() only folds ASCII, so without this a search for
        // "Übersetzung" would miss rows containing "übersetzung" on the desktop
        // while matching on the web. Registering our own keeps the two runtimes
        // consistent and correct for non-ASCII text.
        conn.create_scalar_function(
            "ulower",
            1,
            rusqlite::functions::FunctionFlags::SQLITE_UTF8
                | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
            |ctx| {
                let s: String = ctx.get(0)?;
                Ok(s.to_lowercase())
            },
        )?;

        // Initialize the database schema
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS snippets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                code TEXT NOT NULL,
                language TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets(language);
            CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets(created_at);"
        )?;

        // Migrations: add columns introduced after the initial schema. Guard each
        // on the current column set (rather than running the ALTER and ignoring
        // the error) so a genuine migration failure surfaces instead of being
        // silently swallowed and breaking every later query.
        let existing: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(snippets)")?;
            let cols = stmt.query_map([], |row| row.get::<_, String>(1))?;
            cols.filter_map(|c| c.ok()).collect()
        };
        if !existing.contains("favorite") {
            conn.execute("ALTER TABLE snippets ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !existing.contains("model") {
            conn.execute("ALTER TABLE snippets ADD COLUMN model TEXT NOT NULL DEFAULT ''", [])?;
        }
        if !existing.contains("copy_count") {
            conn.execute("ALTER TABLE snippets ADD COLUMN copy_count INTEGER NOT NULL DEFAULT 0", [])?;
        }
        if !existing.contains("last_used_at") {
            conn.execute("ALTER TABLE snippets ADD COLUMN last_used_at TEXT", [])?;
        }
        // Entry kind: prompt (default) vs. code snippet. The DEFAULT backfills
        // every existing row automatically, so no separate backfill pass is
        // needed (unlike `uuid`).
        if !existing.contains("kind") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN kind TEXT NOT NULL DEFAULT 'prompt'",
                [],
            )?;
        }
        // Per-prompt color tag ('' = none). DEFAULT '' backfills existing rows as
        // uncolored, so no separate backfill pass is needed.
        if !existing.contains("color") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN color TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }
        // Reusable-template flag. DEFAULT 0 backfills existing rows as non-templates.
        if !existing.contains("template") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN template INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        // Device that last wrote the row. DEFAULT '' backfills existing rows.
        if !existing.contains("last_device") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN last_device TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }
        // Collection (folder) label ('' = none). DEFAULT '' backfills existing rows.
        if !existing.contains("collection") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN collection TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }
        // Per-prompt icon (an emoji, '' = none). DEFAULT '' backfills existing rows.
        if !existing.contains("icon") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN icon TEXT NOT NULL DEFAULT ''",
                [],
            )?;
        }

        // Sync support: a stable cross-machine identity and a soft-delete
        // tombstone. `uuid` is added nullable, backfilled for existing rows,
        // then made unique — SQLite can't ALTER-ADD a UNIQUE column directly.
        if !existing.contains("uuid") {
            conn.execute("ALTER TABLE snippets ADD COLUMN uuid TEXT", [])?;
        }
        if !existing.contains("deleted") {
            conn.execute(
                "ALTER TABLE snippets ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        let unfilled: Vec<i64> = {
            let mut stmt =
                conn.prepare("SELECT id FROM snippets WHERE uuid IS NULL OR uuid = ''")?;
            let ids = stmt.query_map([], |row| row.get::<_, i64>(0))?;
            ids.filter_map(|r| r.ok()).collect()
        };
        for id in unfilled {
            conn.execute(
                "UPDATE snippets SET uuid = ? WHERE id = ?",
                params![uuid::Uuid::new_v4().to_string(), id],
            )?;
        }
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_snippets_uuid ON snippets(uuid);",
        )?;

        // Prompt history: an append-only log of prior versions, keyed by the
        // snippet's stable `uuid`. Each edit captures the pre-edit state here so
        // it can be viewed and restored. Local-only (not synced) — append-only,
        // so it never conflicts with the newest-wins sync model.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS snippet_revisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snippet_uuid TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT DEFAULT '',
                code TEXT NOT NULL,
                language TEXT NOT NULL,
                tags TEXT DEFAULT '[]',
                model TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'prompt',
                saved_at TEXT NOT NULL,
                captured_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_revisions_uuid ON snippet_revisions(snippet_uuid, id);",
        )?;

        // Full-text search index (kept in sync by triggers on `snippets`). If the
        // build lacks FTS5, fall back to LIKE search rather than failing to open.
        let fts_enabled = init_fts(&conn).is_ok();

        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
            device: Mutex::new(String::new()),
            fts_enabled,
        })
    }

    /// The filesystem path this database is stored at.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Set this install's device name, stamped onto `last_device` for subsequent
    /// local writes (create/update/restore). Trimmed and capped for safety.
    pub fn set_device(&self, name: &str) {
        let cleaned: String = name.trim().chars().take(64).collect();
        *self.device.lock().unwrap() = cleaned;
    }

    /// The current device name (already trimmed/capped by `set_device`).
    fn device_name(&self) -> String {
        self.device.lock().unwrap().clone()
    }

    /// Write a consistent copy of the database to `dest` using SQLite's online
    /// backup API (safe even while the DB is in use and in WAL mode).
    pub fn backup_to(&self, dest: &Path) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.backup(DatabaseName::Main, dest, None)?;
        Ok(())
    }

    /// Replace this database's contents with those of the SQLite file at `src`,
    /// using SQLite's online restore API — the live connection stays open and
    /// its pages are overwritten atomically, so open handles keep working and
    /// WAL is handled correctly. Validate `src` with `looks_like_snipvault_db`
    /// before calling this.
    pub fn restore_from(&self, src: &Path) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        conn.restore(
            DatabaseName::Main,
            src,
            None::<fn(rusqlite::backup::Progress)>,
        )?;
        Ok(())
    }

    pub fn get_all_snippets(&self, search: Option<&str>, language: Option<&str>, tag: Option<&str>, search_mode: Option<&str>, sort: Option<&str>) -> Result<Vec<Snippet>> {
        let conn = self.conn.lock().unwrap();

        // `deleted = 0` hides soft-deleted (tombstoned) rows, which exist only
        // so the deletion can propagate to other machines during sync.
        let mut sql = format!("SELECT {SNIPPET_COLUMNS} FROM snippets WHERE deleted = 0");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(lang) = language {
            if !lang.is_empty() {
                sql.push_str(" AND language = ?");
                params_vec.push(Box::new(lang.to_string()));
            }
        }

        if let Some(t) = tag {
            if !t.is_empty() {
                // Match the exact tag inside the JSON array (delimited by quotes).
                // The closing quote matters: `%"rust"%` must not also match `"rustacean"`.
                sql.push_str(" AND tags LIKE ? ESCAPE '\\'");
                params_vec.push(Box::new(format!("%\"{}\"%", escape_like(t))));
            }
        }

        if let Some(s) = search {
            if !s.is_empty() {
                // Lower both the needle (here, in Rust) and the columns (via the
                // registered Unicode-aware `ulower`) so non-ASCII search works.
                let search_pattern = format!("%{}%", escape_like(&s.to_lowercase()));
                let mode = search_mode.unwrap_or("all");

                match mode {
                    "title" => {
                        sql.push_str(" AND (ulower(title) LIKE ? ESCAPE '\\' OR ulower(description) LIKE ? ESCAPE '\\')");
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern));
                    }
                    "tags" => {
                        sql.push_str(" AND ulower(tags) LIKE ? ESCAPE '\\'");
                        params_vec.push(Box::new(search_pattern));
                    }
                    _ => {
                        // Default ("all") search: use the FTS5 full-text index
                        // (fast, relevance-tokenized, and it also covers the
                        // prompt body) when available. A non-empty query with no
                        // searchable tokens matches nothing. Fall back to a LIKE
                        // scan over title/description/tags/model if FTS is absent.
                        if self.fts_enabled {
                            match fts_match_query(s) {
                                Some(q) => {
                                    sql.push_str(" AND id IN (SELECT rowid FROM snippets_fts WHERE snippets_fts MATCH ?)");
                                    params_vec.push(Box::new(q));
                                }
                                None => sql.push_str(" AND 0"),
                            }
                        } else {
                            sql.push_str(" AND (ulower(title) LIKE ? ESCAPE '\\' OR ulower(description) LIKE ? ESCAPE '\\' OR ulower(tags) LIKE ? ESCAPE '\\' OR ulower(model) LIKE ? ESCAPE '\\')");
                            params_vec.push(Box::new(search_pattern.clone()));
                            params_vec.push(Box::new(search_pattern.clone()));
                            params_vec.push(Box::new(search_pattern.clone()));
                            params_vec.push(Box::new(search_pattern));
                        }
                    }
                }
            }
        }

        // Pinned (favorite) snippets always float to the top; the rest of the
        // order depends on the requested sort (default newest-first). The key is
        // mapped to a fixed fragment (never interpolated) so it's injection-safe,
        // and it mirrors the web SORT_ORDER map in app/api/snippets/route.ts.
        let order = match sort.unwrap_or("recent") {
            "most-used" => "favorite DESC, copy_count DESC, created_at DESC",
            "recently-used" => "favorite DESC, last_used_at DESC, created_at DESC",
            "alpha" => "favorite DESC, title COLLATE NOCASE ASC",
            _ => "favorite DESC, created_at DESC",
        };
        sql.push_str(" ORDER BY ");
        sql.push_str(order);

        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();

        let mut stmt = conn.prepare(&sql)?;
        let snippet_iter = stmt.query_map(params_refs.as_slice(), row_to_snippet)?;

        let mut snippets = Vec::new();
        for snippet in snippet_iter {
            snippets.push(snippet?);
        }

        Ok(snippets)
    }

    /// Soft-deleted (tombstoned) rows, newest-deleted first — backs the Trash
    /// view. These are hidden from every normal read; they persist only so the
    /// deletion syncs, and so they can be restored. Emptied ("purged") tombstones
    /// — whose content has been blanked by `purge_deleted` — are excluded so an
    /// emptied Trash looks empty, while the tombstone itself lives on for sync.
    pub fn get_deleted(&self) -> Result<Vec<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {SNIPPET_COLUMNS} FROM snippets WHERE deleted = 1 AND (title != '' OR code != '') ORDER BY updated_at DESC"
        ))?;
        let iter = stmt.query_map([], row_to_snippet)?;
        let mut snippets = Vec::new();
        for snippet in iter {
            snippets.push(snippet?);
        }
        Ok(snippets)
    }

    /// Empty the Trash: permanently drop the *content* of every tombstone
    /// (title/description/code/tags/model) while keeping the row as a deleted
    /// tombstone. Blanking rather than hard-deleting is deliberate — the
    /// tombstone must survive so the deletion can't be resurrected by a peer that
    /// still has the row on the next sync. `updated_at` is bumped so the emptied
    /// state itself propagates. Returns how many were purged.
    pub fn purge_deleted(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let n = conn.execute(
            "UPDATE snippets SET title = '', description = '', code = '', tags = '[]', model = '', updated_at = ? WHERE deleted = 1 AND (title != '' OR code != '')",
            params![now],
        )?;
        Ok(n as i64)
    }

    /// Auto-purge: blank the content of tombstones that were deleted (last
    /// updated) more than `days` days ago, keeping the tombstone itself for sync
    /// — the age-filtered version of `purge_deleted`. Fixed-width UTC timestamps
    /// compare correctly as text, so the cutoff comparison is a plain string
    /// compare. Returns how many were purged. A non-positive `days` is a no-op.
    pub fn purge_deleted_older_than(&self, days: i64) -> Result<i64> {
        if days <= 0 {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now();
        let cutoff = (now - chrono::Duration::days(days))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string();
        let now_str = now.format("%Y-%m-%d %H:%M:%S").to_string();
        let n = conn.execute(
            "UPDATE snippets SET title = '', description = '', code = '', tags = '[]', model = '', updated_at = ? \
             WHERE deleted = 1 AND (title != '' OR code != '') AND updated_at < ?",
            params![now_str, cutoff],
        )?;
        Ok(n as i64)
    }

    /// Rename, merge, or delete a tag library-wide. For every (non-deleted)
    /// snippet whose tags contain `from`, replace `from` with `to` (deduped,
    /// order preserved) — or drop it entirely when `to` is None/empty (delete).
    /// Renaming onto a tag some rows already carry merges the two. Only rows that
    /// actually change are rewritten, each with `updated_at` bumped so the change
    /// syncs (newest-wins). `from`/`to` are trimmed + lowercased to match the
    /// app's tag convention. Returns how many rows changed.
    pub fn rewrite_tag(&self, from: &str, to: Option<&str>) -> Result<i64> {
        let from = from.trim().to_lowercase();
        if from.is_empty() {
            return Ok(0);
        }
        let to = to.map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
        if to.as_deref() == Some(from.as_str()) {
            return Ok(0); // renaming to itself is a no-op
        }

        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let rows: Vec<(i64, String)> = {
            let mut stmt = conn.prepare("SELECT id, tags FROM snippets WHERE deleted = 0")?;
            let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            let mut v = Vec::new();
            for row in mapped {
                v.push(row?);
            }
            v
        };

        let mut changed = 0i64;
        for (id, tags_json) in rows {
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            if !tags.iter().any(|t| t == &from) {
                continue;
            }
            let mut next: Vec<String> = Vec::with_capacity(tags.len());
            for t in tags {
                let mapped = if t == from { to.clone() } else { Some(t) };
                if let Some(v) = mapped {
                    if !v.is_empty() && !next.iter().any(|x| x == &v) {
                        next.push(v);
                    }
                }
            }
            let new_json = serde_json::to_string(&next).unwrap_or_else(|_| "[]".to_string());
            if new_json == tags_json {
                continue;
            }
            conn.execute(
                "UPDATE snippets SET tags = ?, updated_at = ? WHERE id = ?",
                params![new_json, now, id],
            )?;
            changed += 1;
        }
        Ok(changed)
    }

    pub fn get_snippet(&self, id: i64) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            &format!("SELECT {SNIPPET_COLUMNS} FROM snippets WHERE id = ?")
        )?;

        let mut rows = stmt.query(params![id])?;

        if let Some(row) = rows.next()? {
            Ok(Some(row_to_snippet(row)?))
        } else {
            Ok(None)
        }
    }

    pub fn create_snippet(&self, input: CreateSnippetInput) -> Result<Snippet> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&input.tags.unwrap_or_default()).unwrap_or_else(|_| "[]".to_string());
        let description = input.description.unwrap_or_default();
        let model = input.model.unwrap_or_default();
        let kind = input.kind.unwrap_or_else(default_kind);
        let color = input.color.unwrap_or_default();
        let template = input.template.unwrap_or(false) as i64;
        let collection = input.collection.unwrap_or_default();
        let icon = input.icon.unwrap_or_default();
        let device = self.device_name();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let uuid = uuid::Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO snippets (uuid, title, description, code, language, tags, model, kind, color, template, last_device, collection, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![uuid, input.title, description, input.code, input.language, tags_json, model, kind, color, template, device, collection, icon, now, now],
        )?;

        let id = conn.last_insert_rowid();
        drop(conn);

        self.get_snippet(id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }

    pub fn update_snippet(&self, id: i64, input: UpdateSnippetInput) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&input.tags.unwrap_or_default()).unwrap_or_else(|_| "[]".to_string());
        let description = input.description.unwrap_or_default();
        let model = input.model.unwrap_or_default();
        let kind = input.kind.unwrap_or_else(default_kind);
        let color = input.color.unwrap_or_default();
        let template = input.template.unwrap_or(false) as i64;
        let collection = input.collection.unwrap_or_default();
        let icon = input.icon.unwrap_or_default();
        let device = self.device_name();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        // Capture the pre-edit state as a revision so it can be viewed/restored.
        // Skip when nothing actually changed (a no-op save shouldn't add
        // history). Read the current row's fields first.
        let current: Option<(String, String, String, String, String, String, String, String, String)> = conn
            .query_row(
                "SELECT uuid, title, description, code, language, tags, model, kind, updated_at FROM snippets WHERE id = ?",
                params![id],
                |r| {
                    Ok((
                        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?,
                        r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?,
                    ))
                },
            )
            .optional()?;

        if let Some((uuid, c_title, c_desc, c_code, c_lang, c_tags, c_model, c_kind, c_updated)) =
            &current
        {
            let unchanged = *c_title == input.title
                && *c_desc == description
                && *c_code == input.code
                && *c_lang == input.language
                && *c_tags == tags_json
                && *c_model == model
                && *c_kind == kind;
            if !unchanged && !uuid.is_empty() {
                conn.execute(
                    "INSERT INTO snippet_revisions (snippet_uuid, title, description, code, language, tags, model, kind, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    params![uuid, c_title, c_desc, c_code, c_lang, c_tags, c_model, c_kind, c_updated],
                )?;
                // Keep only the newest REVISION_KEEP per snippet.
                conn.execute(
                    "DELETE FROM snippet_revisions WHERE snippet_uuid = ?1 AND id NOT IN (SELECT id FROM snippet_revisions WHERE snippet_uuid = ?1 ORDER BY id DESC LIMIT ?2)",
                    params![uuid, REVISION_KEEP],
                )?;
            }
        }

        let rows_affected = conn.execute(
            "UPDATE snippets SET title = ?, description = ?, code = ?, language = ?, tags = ?, model = ?, kind = ?, color = ?, template = ?, last_device = ?, collection = ?, icon = ?, updated_at = ? WHERE id = ?",
            params![input.title, description, input.code, input.language, tags_json, model, kind, color, template, device, collection, icon, now, id],
        )?;

        drop(conn);

        if rows_affected > 0 {
            self.get_snippet(id)
        } else {
            Ok(None)
        }
    }

    /// Past versions of a snippet (by its stable `uuid`), newest first.
    pub fn get_revisions(&self, uuid: &str) -> Result<Vec<SnippetRevision>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, code, language, tags, model, kind, saved_at FROM snippet_revisions WHERE snippet_uuid = ? ORDER BY id DESC",
        )?;
        let iter = stmt.query_map(params![uuid], |row| {
            let tags_str: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
            Ok(SnippetRevision {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                code: row.get(3)?,
                language: row.get(4)?,
                tags,
                model: row.get(6)?,
                kind: row.get(7)?,
                saved_at: row.get(8)?,
            })
        })?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// Soft-delete: flag the row as a tombstone and bump `updated_at` so the
    /// deletion propagates during sync. The row stays in the database (hidden
    /// from every read).
    pub fn delete_snippet(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let rows_affected = conn.execute(
            "UPDATE snippets SET deleted = 1, updated_at = ? WHERE id = ? AND deleted = 0",
            params![now, id],
        )?;
        Ok(rows_affected > 0)
    }

    /// Pin/unpin a snippet. Returns the updated snippet, or `None` if not found.
    pub fn set_favorite(&self, id: i64, favorite: bool) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        // Bump updated_at so a pin/unpin wins during sync (newest edit wins).
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let rows_affected = conn.execute(
            "UPDATE snippets SET favorite = ?, updated_at = ? WHERE id = ?",
            params![favorite as i64, now, id],
        )?;
        drop(conn);

        if rows_affected > 0 {
            self.get_snippet(id)
        } else {
            Ok(None)
        }
    }

    /// Record that a snippet was copied: bump its usage count and stamp the time.
    pub fn record_copy(&self, id: i64) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let rows_affected = conn.execute(
            "UPDATE snippets SET copy_count = copy_count + 1, last_used_at = ? WHERE id = ?",
            params![now, id],
        )?;
        drop(conn);

        if rows_affected > 0 {
            self.get_snippet(id)
        } else {
            Ok(None)
        }
    }

    fn get_snippet_by_uuid(&self, uuid: &str) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            &format!("SELECT {SNIPPET_COLUMNS} FROM snippets WHERE uuid = ?")
        )?;
        let mut rows = stmt.query(params![uuid])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row_to_snippet(row)?))
        } else {
            Ok(None)
        }
    }

    /// Restore a previously deleted snippet (undo-after-delete). With soft
    /// deletes the row still exists, so clear its tombstone in place — this
    /// keeps the same uuid, so the undelete syncs as an ordinary update rather
    /// than creating a duplicate elsewhere. Falls back to re-inserting (with the
    /// original uuid, or a fresh one) only if the row is genuinely gone.
    pub fn restore_snippet(&self, s: Snippet) -> Result<Snippet> {
        // This device is bringing the row back, so it becomes the last writer.
        let device = self.device_name();
        if !s.uuid.is_empty() {
            let conn = self.conn.lock().unwrap();
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let affected = conn.execute(
                "UPDATE snippets SET deleted = 0, last_device = ?, updated_at = ? WHERE uuid = ?",
                params![device, now, s.uuid],
            )?;
            drop(conn);
            if affected > 0 {
                return self
                    .get_snippet_by_uuid(&s.uuid)?
                    .ok_or(rusqlite::Error::QueryReturnedNoRows);
            }
        }

        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".to_string());
        let uuid = if s.uuid.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            s.uuid.clone()
        };

        conn.execute(
            "INSERT INTO snippets (uuid, title, description, code, language, tags, favorite, model, kind, color, template, last_device, collection, icon, copy_count, last_used_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                uuid, s.title, s.description, s.code, s.language, tags_json,
                s.favorite as i64, s.model, s.kind, s.color, s.template as i64, device, s.collection, s.icon, s.copy_count, s.last_used_at, s.created_at, s.updated_at
            ],
        )?;

        let id = conn.last_insert_rowid();
        drop(conn);

        self.get_snippet(id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }

    /// Every row for a sync push — including tombstones — as wire records.
    pub fn get_all_for_sync(&self) -> Result<Vec<SyncRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT uuid, title, description, code, language, tags, favorite, model, \
             copy_count, last_used_at, created_at, updated_at, deleted, kind, color, template, last_device, collection, icon FROM snippets",
        )?;
        let iter = stmt.query_map([], |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            let favorite: i64 = row.get(6)?;
            let deleted: i64 = row.get(12)?;
            Ok(SyncRecord {
                uuid: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                code: row.get(3)?,
                language: row.get(4)?,
                tags,
                favorite: favorite != 0,
                model: row.get(7)?,
                kind: row
                    .get::<_, Option<String>>(13)?
                    .unwrap_or_else(|| "prompt".to_string()),
                color: row.get::<_, Option<String>>(14)?.unwrap_or_default(),
                template: row.get::<_, Option<i64>>(15)?.unwrap_or(0) != 0,
                last_device: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
                collection: row.get::<_, Option<String>>(17)?.unwrap_or_default(),
                icon: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
                copy_count: row
                    .get::<_, i64>(8)
                    .or_else(|_| row.get::<_, f64>(8).map(|f| f as i64))?,
                last_used_at: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
                deleted: deleted != 0,
            })
        })?;
        let mut out = Vec::new();
        for r in iter {
            out.push(r?);
        }
        Ok(out)
    }

    /// Merge incoming sync records into the local database, newest `updated_at`
    /// winning per uuid (fixed-width UTC timestamps compare correctly as text).
    /// Rows with an unknown uuid are inserted; records without a uuid are
    /// skipped.
    ///
    /// Returns `(applied, conflicts)`: `applied` is how many rows were inserted
    /// or updated; `conflicts` is how many of those updates overwrote a local row
    /// whose *content had diverged* from the incoming edit — i.e. a real
    /// conflicting edit made on two devices. Before such an overwrite the local
    /// version is captured into `snippet_revisions`, so newest-wins never
    /// silently loses it — it's recoverable from the prompt's History.
    pub fn apply_sync_records(&self, records: Vec<SyncRecord>) -> Result<(i64, i64)> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut applied = 0i64;
        let mut conflicts = 0i64;
        for rec in records {
            if rec.uuid.is_empty() {
                continue;
            }
            let tags_json =
                serde_json::to_string(&rec.tags).unwrap_or_else(|_| "[]".to_string());
            // Fetch the local row's timestamp plus the content fields, so an
            // overwrite that would drop a diverging local edit can preserve it.
            let existing: Option<(String, String, String, String, String, String, String, String)> =
                tx.query_row(
                    "SELECT updated_at, title, description, code, language, tags, model, kind FROM snippets WHERE uuid = ?",
                    params![rec.uuid],
                    |r| {
                        Ok((
                            r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                            r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
                        ))
                    },
                )
                .optional()?;
            match existing {
                None => {
                    tx.execute(
                        "INSERT INTO snippets (uuid, title, description, code, language, tags, favorite, model, kind, color, template, last_device, collection, icon, copy_count, last_used_at, created_at, updated_at, deleted)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        params![
                            rec.uuid, rec.title, rec.description, rec.code, rec.language, tags_json,
                            rec.favorite as i64, rec.model, rec.kind, rec.color, rec.template as i64, rec.last_device, rec.collection, rec.icon, rec.copy_count, rec.last_used_at,
                            rec.created_at, rec.updated_at, rec.deleted as i64
                        ],
                    )?;
                    applied += 1;
                }
                Some((cur_updated, c_title, c_desc, c_code, c_lang, c_tags, c_model, c_kind))
                    if rec.updated_at > cur_updated =>
                {
                    // The incoming edit is newer and will overwrite the local
                    // row. If the local *content* actually diverged (a genuine
                    // conflicting edit, not just a metadata/timestamp bump),
                    // capture the local version into history first so it isn't
                    // lost, and count it as a conflict.
                    let content_differs = c_title != rec.title
                        || c_desc != rec.description
                        || c_code != rec.code
                        || c_lang != rec.language
                        || c_tags != tags_json
                        || c_model != rec.model
                        || c_kind != rec.kind;
                    if content_differs {
                        tx.execute(
                            "INSERT INTO snippet_revisions (snippet_uuid, title, description, code, language, tags, model, kind, saved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                            params![rec.uuid, c_title, c_desc, c_code, c_lang, c_tags, c_model, c_kind, cur_updated],
                        )?;
                        tx.execute(
                            "DELETE FROM snippet_revisions WHERE snippet_uuid = ?1 AND id NOT IN (SELECT id FROM snippet_revisions WHERE snippet_uuid = ?1 ORDER BY id DESC LIMIT ?2)",
                            params![rec.uuid, REVISION_KEEP],
                        )?;
                        conflicts += 1;
                    }
                    tx.execute(
                        "UPDATE snippets SET title = ?, description = ?, code = ?, language = ?, tags = ?, favorite = ?, model = ?, kind = ?, color = ?, template = ?, last_device = ?, collection = ?, icon = ?, copy_count = ?, last_used_at = ?, created_at = ?, updated_at = ?, deleted = ? WHERE uuid = ?",
                        params![
                            rec.title, rec.description, rec.code, rec.language, tags_json,
                            rec.favorite as i64, rec.model, rec.kind, rec.color, rec.template as i64, rec.last_device, rec.collection, rec.icon, rec.copy_count, rec.last_used_at,
                            rec.created_at, rec.updated_at, rec.deleted as i64, rec.uuid
                        ],
                    )?;
                    applied += 1;
                }
                _ => {}
            }
        }
        tx.commit()?;
        Ok((applied, conflicts))
    }
}

#[cfg(test)]
mod sqli_tests {
    //! Adversarial SQL-injection tests for the desktop (rusqlite) backend.
    //! Goal: prove that no user-controlled string — search term, tag, language,
    //! search mode, or any write field — can drop the table, delete rows it
    //! shouldn't, or otherwise execute as SQL. Payloads must be stored/matched
    //! as inert literal data.
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Classic injection / stacked-query / wildcard payloads.
    const PAYLOADS: &[&str] = &[
        "'; DROP TABLE snippets; --",
        "'); DROP TABLE snippets; --",
        "1; DROP TABLE snippets",
        "' OR '1'='1",
        "\" OR \"\"=\"",
        "'; DELETE FROM snippets; --",
        "' UNION SELECT * FROM sqlite_master --",
        "%",
        "_",
        "\\",
        "robert'); DROP TABLE snippets;--", // little Bobby Tables
    ];

    fn temp_db() -> Database {
        let mut p = std::env::temp_dir();
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        p.push(format!("snipvault_sqli_{n}.db"));
        Database::open(&p).unwrap()
    }

    fn mk(title: &str, code: &str) -> CreateSnippetInput {
        CreateSnippetInput {
            title: title.into(),
            description: Some("desc".into()),
            code: code.into(),
            language: "text".into(),
            tags: Some(vec!["rust".into()]),
            model: None,
            kind: None,
            color: None,
            template: None,
            collection: None,
            icon: None,
        }
    }

    fn table_exists(db: &Database) -> bool {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='snippets'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn read_filters_cannot_execute_sql() {
        let db = temp_db();
        db.create_snippet(mk("hello", "world")).unwrap();
        db.create_snippet(mk("second", "row")).unwrap();

        for p in PAYLOADS {
            // Every filter dimension, plus a malicious search_mode.
            db.get_all_snippets(Some(p), None, None, Some("all"), None).unwrap();
            db.get_all_snippets(None, Some(p), None, None, None).unwrap();
            db.get_all_snippets(None, None, Some(p), None, None).unwrap();
            db.get_all_snippets(Some(p), Some(p), Some(p), Some(p), Some(p)).unwrap();
            assert!(table_exists(&db), "table dropped by read payload {p:?}");
        }
        // Both seed rows survive every payload.
        assert_eq!(db.get_all_snippets(None, None, None, None, None).unwrap().len(), 2);
    }

    #[test]
    fn write_fields_are_stored_not_executed() {
        let db = temp_db();
        db.create_snippet(mk("hello", "world")).unwrap();

        // Insert each payload as title/code/tag; none may execute.
        for p in PAYLOADS {
            let mut input = mk(p, p);
            input.tags = Some(vec![p.to_string()]);
            let created = db.create_snippet(input).unwrap();
            // Round-trips as literal data.
            assert_eq!(created.title, *p);
            assert_eq!(created.code, *p);
            assert!(table_exists(&db), "table dropped by write payload {p:?}");
        }

        // update / delete / favorite / restore with a payload id-less path.
        let id = db.create_snippet(mk("target", "x")).unwrap().id;
        db.update_snippet(
            id,
            UpdateSnippetInput {
                title: "'; DROP TABLE snippets; --".into(),
                description: None,
                code: "'; DELETE FROM snippets --".into(),
                language: "text".into(),
                tags: Some(vec!["'; DROP TABLE snippets; --".into()]),
                model: Some("'); DROP TABLE snippets;--".into()),
                kind: None,
                color: None,
                template: None,
                collection: None,
                icon: None,
            },
        )
        .unwrap();
        assert!(table_exists(&db));

        // The DROP string was stored literally — we can find it by title search.
        let hits = db
            .get_all_snippets(Some("drop table snippets"), None, None, Some("title"), None)
            .unwrap();
        assert!(
            hits.iter().any(|s| s.title.contains("DROP TABLE")),
            "payload was not stored as literal data"
        );

        // Seed + all payload rows + target row all still present.
        let total = db.get_all_snippets(None, None, None, None, None).unwrap().len();
        assert_eq!(total, 1 + PAYLOADS.len() + 1);
    }

    #[test]
    fn kind_defaults_to_prompt_and_round_trips() {
        let db = temp_db();

        // Omitted kind → defaults to "prompt".
        let a = db.create_snippet(mk("plain", "body")).unwrap();
        assert_eq!(a.kind, "prompt");

        // Explicit "code" kind persists on create and reads back.
        let mut code_input = mk("snippet", "let x = 1;");
        code_input.kind = Some("code".into());
        let b = db.create_snippet(code_input).unwrap();
        assert_eq!(b.kind, "code");
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().kind, "code");

        // Update can switch kind (prompt → code) and it persists.
        db.update_snippet(
            a.id,
            UpdateSnippetInput {
                title: "plain".into(),
                description: None,
                code: "body".into(),
                language: "text".into(),
                tags: None,
                model: None,
                kind: Some("code".into()),
                color: None,
                template: None,
                collection: None,
                icon: None,
            },
        )
        .unwrap();
        assert_eq!(db.get_snippet(a.id).unwrap().unwrap().kind, "code");

        // kind survives a sync round-trip (export → re-import into a fresh DB).
        let records = db.get_all_for_sync().unwrap();
        assert!(records.iter().any(|r| r.kind == "code"));
        let db2 = temp_db();
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None, None).unwrap();
        assert!(synced.iter().any(|s| s.title == "snippet" && s.kind == "code"));
    }

    #[test]
    fn color_defaults_empty_and_round_trips() {
        let db = temp_db();

        // Omitted color → "" (no color).
        let a = db.create_snippet(mk("plain", "body")).unwrap();
        assert_eq!(a.color, "");

        // A color set on create persists and reads back.
        let mut colored = mk("tagged", "body");
        colored.color = Some("blue".into());
        let b = db.create_snippet(colored).unwrap();
        assert_eq!(b.color, "blue");
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().color, "blue");

        // Update can change the color (blue → green) and clear it back to "".
        let recolor = |id: i64, color: Option<String>, db: &Database| {
            db.update_snippet(
                id,
                UpdateSnippetInput {
                    title: "tagged".into(),
                    description: None,
                    code: "body".into(),
                    language: "text".into(),
                    tags: None,
                    model: None,
                    kind: None,
                    color,
                    template: None,
                    collection: None,
                    icon: None,
                },
            )
            .unwrap();
        };
        recolor(b.id, Some("green".into()), &db);
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().color, "green");
        recolor(b.id, Some("".into()), &db);
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().color, "");

        // color survives a sync round-trip (export → re-import into a fresh DB).
        recolor(b.id, Some("violet".into()), &db);
        let records = db.get_all_for_sync().unwrap();
        assert!(records.iter().any(|r| r.color == "violet"));
        let db2 = temp_db();
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None, None).unwrap();
        assert!(synced.iter().any(|s| s.title == "tagged" && s.color == "violet"));
    }

    #[test]
    fn template_flag_defaults_false_and_round_trips() {
        let db = temp_db();

        // Omitted → not a template.
        let a = db.create_snippet(mk("plain", "body")).unwrap();
        assert!(!a.template);

        // Set on create, reads back true.
        let mut tpl = mk("starter", "Dear {{name}}");
        tpl.template = Some(true);
        let b = db.create_snippet(tpl).unwrap();
        assert!(b.template);
        assert!(db.get_snippet(b.id).unwrap().unwrap().template);

        // Update can clear the flag.
        db.update_snippet(
            b.id,
            UpdateSnippetInput {
                title: "starter".into(),
                description: None,
                code: "Dear {{name}}".into(),
                language: "text".into(),
                tags: None,
                model: None,
                kind: None,
                color: None,
                template: Some(false),
                collection: None,
                icon: None,
            },
        )
        .unwrap();
        assert!(!db.get_snippet(b.id).unwrap().unwrap().template);

        // Survives a sync round-trip.
        db.update_snippet(
            b.id,
            UpdateSnippetInput {
                title: "starter".into(),
                description: None,
                code: "Dear {{name}}".into(),
                language: "text".into(),
                tags: None,
                model: None,
                kind: None,
                color: None,
                template: Some(true),
                collection: None,
                icon: None,
            },
        )
        .unwrap();
        let records = db.get_all_for_sync().unwrap();
        assert!(records.iter().any(|r| r.template));
        let db2 = temp_db();
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None, None).unwrap();
        assert!(synced.iter().any(|s| s.title == "starter" && s.template));
    }

    #[test]
    fn collection_defaults_empty_and_round_trips() {
        let db = temp_db();

        // Omitted collection → "" (none).
        let a = db.create_snippet(mk("loose", "body")).unwrap();
        assert_eq!(a.collection, "");

        // A collection set on create persists and reads back.
        let mut filed = mk("filed", "body");
        filed.collection = Some("Work".into());
        let b = db.create_snippet(filed).unwrap();
        assert_eq!(b.collection, "Work");
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().collection, "Work");

        // Update can move it to another collection and clear it back to "".
        let refile = |id: i64, collection: Option<String>, db: &Database| {
            db.update_snippet(
                id,
                UpdateSnippetInput {
                    title: "filed".into(),
                    description: None,
                    code: "body".into(),
                    language: "text".into(),
                    tags: None,
                    model: None,
                    kind: None,
                    color: None,
                    template: None,
                    collection,
                    icon: None,
                },
            )
            .unwrap();
        };
        refile(b.id, Some("Personal".into()), &db);
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().collection, "Personal");
        refile(b.id, Some("".into()), &db);
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().collection, "");

        // collection survives a sync round-trip (export → re-import into a fresh DB).
        refile(b.id, Some("Archive".into()), &db);
        let records = db.get_all_for_sync().unwrap();
        assert!(records.iter().any(|r| r.collection == "Archive"));
        let db2 = temp_db();
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None, None).unwrap();
        assert!(synced.iter().any(|s| s.title == "filed" && s.collection == "Archive"));
    }

    #[test]
    fn icon_defaults_empty_and_round_trips() {
        let db = temp_db();

        // Omitted icon → "" (none).
        let a = db.create_snippet(mk("plain", "body")).unwrap();
        assert_eq!(a.icon, "");

        // An icon set on create persists and reads back.
        let mut with_icon = mk("rocket", "body");
        with_icon.icon = Some("🚀".into());
        let b = db.create_snippet(with_icon).unwrap();
        assert_eq!(b.icon, "🚀");
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().icon, "🚀");

        // Update can change the icon and clear it back to "".
        let reicon = |id: i64, icon: Option<String>, db: &Database| {
            db.update_snippet(
                id,
                UpdateSnippetInput {
                    title: "rocket".into(),
                    description: None,
                    code: "body".into(),
                    language: "text".into(),
                    tags: None,
                    model: None,
                    kind: None,
                    color: None,
                    template: None,
                    collection: None,
                    icon,
                },
            )
            .unwrap();
        };
        reicon(b.id, Some("⭐".into()), &db);
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().icon, "⭐");
        reicon(b.id, Some("".into()), &db);
        assert_eq!(db.get_snippet(b.id).unwrap().unwrap().icon, "");

        // icon survives a sync round-trip (export → re-import into a fresh DB).
        reicon(b.id, Some("🔥".into()), &db);
        let records = db.get_all_for_sync().unwrap();
        assert!(records.iter().any(|r| r.icon == "🔥"));
        let db2 = temp_db();
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None, None).unwrap();
        assert!(synced.iter().any(|s| s.title == "rocket" && s.icon == "🔥"));
    }

    #[test]
    fn sync_overwrite_of_a_diverged_edit_is_preserved_to_history() {
        // A prompt exists on two devices; both edit it while offline. On sync the
        // newer edit wins — but the older, overwritten local edit must be saved to
        // history (not silently lost) and reported as a conflict.
        let local = temp_db();
        let s = local.create_snippet(mk("shared", "original")).unwrap();
        let uuid = s.uuid.clone();

        // This device makes an edit ("local edit").
        local
            .update_snippet(
                s.id,
                UpdateSnippetInput {
                    title: "shared".into(),
                    description: None,
                    code: "my local edit".into(),
                    language: "text".into(),
                    tags: None,
                    model: None,
                    kind: None,
                    color: None,
                    template: None,
                    collection: None,
                    icon: None,
                },
            )
            .unwrap();

        // A newer edit arrives from another device (later updated_at, different
        // content) via sync.
        let incoming = SyncRecord {
            uuid: uuid.clone(),
            title: "shared".into(),
            description: String::new(),
            code: "their newer edit".into(),
            language: "text".into(),
            tags: vec![],
            favorite: false,
            model: String::new(),
            kind: "prompt".into(),
            color: String::new(),
            template: false,
            last_device: "other".into(),
            collection: String::new(),
            icon: String::new(),
            copy_count: 0,
            last_used_at: None,
            created_at: "2999-01-01 00:00:00".into(),
            updated_at: "2999-01-01 00:00:00".into(),
            deleted: false,
        };
        let (applied, conflicts) = local.apply_sync_records(vec![incoming]).unwrap();
        assert_eq!(applied, 1);
        assert_eq!(conflicts, 1, "a diverging overwrite must be counted");

        // The live row now holds the winning (remote) edit...
        assert_eq!(local.get_snippet(s.id).unwrap().unwrap().code, "their newer edit");
        // ...and the overwritten local edit is recoverable from history.
        let revs = local.get_revisions(&uuid).unwrap();
        assert!(
            revs.iter().any(|r| r.code == "my local edit"),
            "overwritten local edit must be preserved in history"
        );

        // A non-diverging update (same content, newer only by timestamp) is not a
        // conflict.
        let same = SyncRecord {
            updated_at: "2999-06-01 00:00:00".into(),
            created_at: "2999-06-01 00:00:00".into(),
            code: "their newer edit".into(),
            ..local
                .get_all_for_sync()
                .unwrap()
                .into_iter()
                .find(|r| r.uuid == uuid)
                .unwrap()
        };
        let (_applied2, conflicts2) = local.apply_sync_records(vec![same]).unwrap();
        assert_eq!(conflicts2, 0, "an identical-content update is not a conflict");
    }

    #[test]
    fn last_device_is_stamped_and_travels_with_sync() {
        let db = temp_db();

        // No device set yet → "" (unknown).
        let a = db.create_snippet(mk("first", "x")).unwrap();
        assert_eq!(a.last_device, "");

        // After naming this device, new writes are stamped.
        db.set_device("laptop");
        let b = db.create_snippet(mk("second", "y")).unwrap();
        assert_eq!(b.last_device, "laptop");

        // An update re-stamps with the current device name.
        db.set_device("desktop");
        db.update_snippet(
            a.id,
            UpdateSnippetInput {
                title: "first".into(),
                description: None,
                code: "x2".into(),
                language: "text".into(),
                tags: None,
                model: None,
                kind: None,
                color: None,
                template: None,
                collection: None,
                icon: None,
            },
        )
        .unwrap();
        assert_eq!(db.get_snippet(a.id).unwrap().unwrap().last_device, "desktop");

        // The stamp travels through sync to another database (which preserves the
        // *remote* device, not stamping its own).
        let records = db.get_all_for_sync().unwrap();
        let db2 = temp_db();
        db2.set_device("phone");
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None, None).unwrap();
        let second = synced.iter().find(|s| s.title == "second").unwrap();
        assert_eq!(second.last_device, "laptop");
    }

    #[test]
    fn full_text_search_matches_body_prefix_and_survives_special_chars() {
        let db = temp_db();
        db.create_snippet(mk("Alpha", "the quick brown fox")).unwrap();
        db.create_snippet(mk("Beta", "lazy dog sleeps")).unwrap();

        // Default ("all") search now covers the body: "fox" finds Alpha even
        // though the word is only in the body, not the title/tags.
        let hits = db
            .get_all_snippets(Some("fox"), None, None, Some("all"), None)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].title, "Alpha");

        // Prefix matching: "qui" matches "quick".
        let pre = db
            .get_all_snippets(Some("qui"), None, None, Some("all"), None)
            .unwrap();
        assert!(pre.iter().any(|s| s.title == "Alpha"));

        // Multiple tokens are AND-ed together.
        let both = db
            .get_all_snippets(Some("lazy dog"), None, None, Some("all"), None)
            .unwrap();
        assert_eq!(both.len(), 1);
        assert_eq!(both[0].title, "Beta");

        // FTS query-syntax characters can't error or inject — each is just data.
        for q in ["\" OR 1", "fox*", "NEAR(a b)", ":col", "a AND b", "((("] {
            let _ = db
                .get_all_snippets(Some(q), None, None, Some("all"), None)
                .unwrap();
        }
        assert!(table_exists(&db));

        // The triggers keep the index current: after an edit, the old body term is
        // gone and the new one is found.
        let beta_id = both[0].id;
        db.update_snippet(
            beta_id,
            UpdateSnippetInput {
                title: "Beta".into(),
                description: None,
                code: "totally different now".into(),
                language: "text".into(),
                tags: None,
                model: None,
                kind: None,
                color: None,
                template: None,
                collection: None,
                icon: None,
            },
        )
        .unwrap();
        let gone = db
            .get_all_snippets(Some("dog"), None, None, Some("all"), None)
            .unwrap();
        assert!(gone.is_empty(), "index must drop the old body on edit");
        let now = db
            .get_all_snippets(Some("different"), None, None, Some("all"), None)
            .unwrap();
        assert_eq!(now.len(), 1);
        assert_eq!(now[0].title, "Beta");
    }

    #[test]
    fn wildcard_payloads_match_literally_not_as_wildcards() {
        let db = temp_db();
        db.create_snippet(mk("alpha", "one")).unwrap();
        db.create_snippet(mk("beta", "two")).unwrap();
        // A search of "%" must NOT match everything — it's escaped to a literal %.
        let pct = db.get_all_snippets(Some("%"), None, None, Some("all"), None).unwrap();
        assert_eq!(pct.len(), 0, "'%' acted as a wildcard instead of a literal");
        let underscore = db.get_all_snippets(Some("_"), None, None, Some("all"), None).unwrap();
        assert_eq!(underscore.len(), 0, "'_' acted as a wildcard instead of a literal");
    }

    #[test]
    fn sort_orders_respect_pins_and_keys() {
        let db = temp_db();
        // Three rows with distinct titles; give one a higher copy_count and pin
        // another so we can tell the sort keys apart.
        let a = db.create_snippet(mk("banana", "1")).unwrap();
        let b = db.create_snippet(mk("apple", "2")).unwrap();
        let c = db.create_snippet(mk("cherry", "3")).unwrap();
        // "apple" gets used the most; "cherry" is pinned.
        db.record_copy(b.id).unwrap();
        db.record_copy(b.id).unwrap();
        db.set_favorite(c.id, true).unwrap();

        // Alphabetical, but the pinned row still leads.
        let alpha = db
            .get_all_snippets(None, None, None, None, Some("alpha"))
            .unwrap();
        assert_eq!(alpha[0].title, "cherry", "pinned row must lead every sort");
        assert_eq!(
            alpha.iter().map(|s| s.title.clone()).collect::<Vec<_>>(),
            vec!["cherry", "apple", "banana"],
        );

        // Most-used: pinned "cherry" leads, then the row with the most copies.
        let most = db
            .get_all_snippets(None, None, None, None, Some("most-used"))
            .unwrap();
        assert_eq!(most[0].title, "cherry");
        assert_eq!(most[1].title, "apple");

        // Unknown/garbage sort key falls back to newest-first (no error).
        let fallback = db
            .get_all_snippets(None, None, None, None, Some("'; DROP TABLE snippets; --"))
            .unwrap();
        assert!(table_exists(&db));
        assert_eq!(fallback.len(), 3);
        assert_eq!(fallback[0].title, "cherry", "pin still leads on fallback");
        let _ = a;
    }

    #[test]
    fn backup_validates_and_restores_the_whole_db() {
        let src = temp_db();
        src.create_snippet(mk("survivor", "payload")).unwrap();

        // Consistent snapshot to a file.
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dest = std::env::temp_dir().join(format!("snipvault_bk_{n}.db"));
        src.backup_to(&dest).unwrap();

        // The snapshot is recognised as a SnipVault database...
        assert!(looks_like_snipvault_db(&dest));
        // ...while an unrelated file is not (guards restore from clobbering data).
        let junk = std::env::temp_dir().join(format!("snipvault_junk_{n}.txt"));
        std::fs::write(&junk, b"definitely not a database").unwrap();
        assert!(!looks_like_snipvault_db(&junk));

        // Restore into a fresh, empty database — the row comes back.
        let target = temp_db();
        assert_eq!(
            target.get_all_snippets(None, None, None, None, None).unwrap().len(),
            0
        );
        target.restore_from(&dest).unwrap();
        let rows = target.get_all_snippets(None, None, None, None, None).unwrap();
        assert!(rows.iter().any(|s| s.title == "survivor"), "restore lost the row");

        let _ = std::fs::remove_file(&dest);
        let _ = std::fs::remove_file(&junk);
    }

    #[test]
    fn empty_trash_blanks_tombstones_but_keeps_them_for_sync() {
        let db = temp_db();
        let a = db.create_snippet(mk("keep", "alive")).unwrap();
        let b = db.create_snippet(mk("bin", "me")).unwrap();

        // Delete one → it shows in Trash.
        db.delete_snippet(b.id).unwrap();
        assert_eq!(db.get_deleted().unwrap().len(), 1);

        // Empty the Trash → the tombstone's content is blanked and it drops out
        // of the Trash view, but the row survives (deleted=1) for sync.
        let purged = db.purge_deleted().unwrap();
        assert_eq!(purged, 1);
        assert_eq!(db.get_deleted().unwrap().len(), 0, "purged tombstone hidden");

        // The row still exists as a tombstone in the full sync set, blanked.
        let all = db.get_all_for_sync().unwrap();
        let tomb = all.iter().find(|r| r.uuid == b.uuid).expect("tombstone kept");
        assert!(tomb.deleted);
        assert_eq!(tomb.title, "");
        assert_eq!(tomb.code, "");

        // The live snippet is untouched, and a second purge is a no-op.
        assert_eq!(db.get_snippet(a.id).unwrap().unwrap().title, "keep");
        assert_eq!(db.purge_deleted().unwrap(), 0);
    }

    #[test]
    fn auto_purge_blanks_only_old_tombstones() {
        let db = temp_db();
        let a = db.create_snippet(mk("recent", "x")).unwrap();
        let b = db.create_snippet(mk("old", "y")).unwrap();
        db.delete_snippet(a.id).unwrap();
        db.delete_snippet(b.id).unwrap();

        // Backdate b's tombstone to 40 days ago (a was just deleted → recent).
        {
            let conn = db.conn.lock().unwrap();
            let old = (chrono::Utc::now() - chrono::Duration::days(40))
                .format("%Y-%m-%d %H:%M:%S")
                .to_string();
            conn.execute(
                "UPDATE snippets SET updated_at = ? WHERE id = ?",
                params![old, b.id],
            )
            .unwrap();
        }

        // Purge tombstones older than 30 days → only b.
        assert_eq!(db.purge_deleted_older_than(30).unwrap(), 1);

        // b is blanked (dropped from the Trash view); a still there.
        let trash = db.get_deleted().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].title, "recent");

        // b survives as a blanked tombstone for sync.
        let all = db.get_all_for_sync().unwrap();
        let tomb = all.iter().find(|r| r.uuid == b.uuid).expect("tombstone kept");
        assert!(tomb.deleted);
        assert_eq!(tomb.title, "");

        // Idempotent: nothing left older than 30 days now.
        assert_eq!(db.purge_deleted_older_than(30).unwrap(), 0);
        // A zero/negative retention is a no-op.
        assert_eq!(db.purge_deleted_older_than(0).unwrap(), 0);
    }

    #[test]
    fn edits_capture_revisions_and_noops_do_not() {
        let db = temp_db();
        let s = db.create_snippet(mk("v1", "body one")).unwrap();

        // A fresh snippet has no history yet.
        assert_eq!(db.get_revisions(&s.uuid).unwrap().len(), 0);

        // First real edit captures the prior ("v1") state.
        let upd = |title: &str, code: &str| UpdateSnippetInput {
            title: title.into(),
            description: Some("desc".into()),
            code: code.into(),
            language: "text".into(),
            tags: Some(vec!["rust".into()]),
            model: None,
            kind: None,
            color: None,
            template: None,
            collection: None,
            icon: None,
        };
        db.update_snippet(s.id, upd("v2", "body two")).unwrap();
        let revs = db.get_revisions(&s.uuid).unwrap();
        assert_eq!(revs.len(), 1);
        assert_eq!(revs[0].title, "v1");
        assert_eq!(revs[0].code, "body one");

        // A no-op save (identical content) must not add a revision.
        db.update_snippet(s.id, upd("v2", "body two")).unwrap();
        assert_eq!(db.get_revisions(&s.uuid).unwrap().len(), 1);

        // A second real edit captures "v2", newest first.
        db.update_snippet(s.id, upd("v3", "body three")).unwrap();
        let revs = db.get_revisions(&s.uuid).unwrap();
        assert_eq!(revs.len(), 2);
        assert_eq!(revs[0].title, "v2");
        assert_eq!(revs[1].title, "v1");

        // "Restore v1" = update with the old content; the current ("v3") state is
        // itself captured, so history grows and the live row becomes v1 again.
        db.update_snippet(s.id, upd("v1", "body one")).unwrap();
        assert_eq!(db.get_snippet(s.id).unwrap().unwrap().title, "v1");
        let revs = db.get_revisions(&s.uuid).unwrap();
        assert_eq!(revs.len(), 3);
        assert_eq!(revs[0].title, "v3");
    }

    #[test]
    fn rewrite_tag_renames_merges_and_deletes_across_the_library() {
        let db = temp_db();
        let tagged = |title: &str, tags: Vec<&str>| CreateSnippetInput {
            title: title.into(),
            description: None,
            code: "body".into(),
            language: "text".into(),
            tags: Some(tags.into_iter().map(String::from).collect()),
            model: None,
            kind: None,
            color: None,
            template: None,
            collection: None,
            icon: None,
        };
        let a = db.create_snippet(tagged("a", vec!["rust", "cli"])).unwrap();
        let b = db.create_snippet(tagged("b", vec!["rust"])).unwrap();
        let c = db.create_snippet(tagged("c", vec!["python"])).unwrap();

        let tags_of = |id: i64, db: &Database| db.get_snippet(id).unwrap().unwrap().tags;

        // Rename: rust → rustlang touches the two rows that carry it.
        assert_eq!(db.rewrite_tag("rust", Some("rustlang")).unwrap(), 2);
        assert_eq!(tags_of(a.id, &db), vec!["rustlang", "cli"]);
        assert_eq!(tags_of(b.id, &db), vec!["rustlang"]);
        assert_eq!(tags_of(c.id, &db), vec!["python"]); // untouched

        // Merge: renaming cli → rustlang on a row that already has rustlang
        // collapses to a single, deduped tag.
        assert_eq!(db.rewrite_tag("cli", Some("rustlang")).unwrap(), 1);
        assert_eq!(tags_of(a.id, &db), vec!["rustlang"]);

        // Input is normalized (trim + lowercase) to match stored tags.
        assert_eq!(db.rewrite_tag("  PYTHON ", Some("Py")).unwrap(), 1);
        assert_eq!(tags_of(c.id, &db), vec!["py"]);

        // Delete: dropping a tag removes it everywhere and bumps updated_at (so it
        // syncs). A no-op rename (to itself) and an absent tag change nothing.
        assert_eq!(db.rewrite_tag("rustlang", None).unwrap(), 2);
        assert_eq!(tags_of(a.id, &db), Vec::<String>::new());
        assert_eq!(tags_of(b.id, &db), Vec::<String>::new());
        assert_eq!(db.rewrite_tag("py", Some("py")).unwrap(), 0);
        assert_eq!(db.rewrite_tag("nonexistent", Some("x")).unwrap(), 0);
    }
}
