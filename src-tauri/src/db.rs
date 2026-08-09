use rusqlite::{Connection, DatabaseName, OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The full column list, in the order `row_to_snippet` expects. Kept in one
/// place so every SELECT stays in sync with the row mapper. New columns (`uuid`,
/// then `kind`) are appended last so the earlier indices stay stable.
const SNIPPET_COLUMNS: &str =
    "id, title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at, uuid, kind";

/// Escape LIKE metacharacters so user input matches literally. Must be paired
/// with an `ESCAPE '\'` clause on the LIKE. Without this, a search or tag value
/// containing `%` or `_` would act as a wildcard (e.g. `%` matches everything).
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
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

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
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

        Ok(Self {
            conn: Mutex::new(conn),
            path: path.to_path_buf(),
        })
    }

    /// The filesystem path this database is stored at.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Write a consistent copy of the database to `dest` using SQLite's online
    /// backup API (safe even while the DB is in use and in WAL mode).
    pub fn backup_to(&self, dest: &Path) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.backup(DatabaseName::Main, dest, None)?;
        Ok(())
    }

    pub fn get_all_snippets(&self, search: Option<&str>, language: Option<&str>, tag: Option<&str>, search_mode: Option<&str>) -> Result<Vec<Snippet>> {
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
                        sql.push_str(" AND (ulower(title) LIKE ? ESCAPE '\\' OR ulower(description) LIKE ? ESCAPE '\\' OR ulower(tags) LIKE ? ESCAPE '\\' OR ulower(model) LIKE ? ESCAPE '\\')");
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern));
                    }
                }
            }
        }

        // Pinned (favorite) snippets float to the top, newest first within each group.
        sql.push_str(" ORDER BY favorite DESC, created_at DESC");

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
    /// deletion syncs, and so they can be restored.
    pub fn get_deleted(&self) -> Result<Vec<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(&format!(
            "SELECT {SNIPPET_COLUMNS} FROM snippets WHERE deleted = 1 ORDER BY updated_at DESC"
        ))?;
        let iter = stmt.query_map([], row_to_snippet)?;
        let mut snippets = Vec::new();
        for snippet in iter {
            snippets.push(snippet?);
        }
        Ok(snippets)
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
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let uuid = uuid::Uuid::new_v4().to_string();

        conn.execute(
            "INSERT INTO snippets (uuid, title, description, code, language, tags, model, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![uuid, input.title, description, input.code, input.language, tags_json, model, kind, now, now],
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
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let rows_affected = conn.execute(
            "UPDATE snippets SET title = ?, description = ?, code = ?, language = ?, tags = ?, model = ?, kind = ?, updated_at = ? WHERE id = ?",
            params![input.title, description, input.code, input.language, tags_json, model, kind, now, id],
        )?;

        drop(conn);

        if rows_affected > 0 {
            self.get_snippet(id)
        } else {
            Ok(None)
        }
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
        if !s.uuid.is_empty() {
            let conn = self.conn.lock().unwrap();
            let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
            let affected = conn.execute(
                "UPDATE snippets SET deleted = 0, updated_at = ? WHERE uuid = ?",
                params![now, s.uuid],
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
            "INSERT INTO snippets (uuid, title, description, code, language, tags, favorite, model, kind, copy_count, last_used_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                uuid, s.title, s.description, s.code, s.language, tags_json,
                s.favorite as i64, s.model, s.kind, s.copy_count, s.last_used_at, s.created_at, s.updated_at
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
             copy_count, last_used_at, created_at, updated_at, deleted, kind FROM snippets",
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
    /// skipped. Returns how many rows were inserted or updated.
    pub fn apply_sync_records(&self, records: Vec<SyncRecord>) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let mut applied = 0i64;
        for rec in records {
            if rec.uuid.is_empty() {
                continue;
            }
            let tags_json =
                serde_json::to_string(&rec.tags).unwrap_or_else(|_| "[]".to_string());
            let existing: Option<String> = tx
                .query_row(
                    "SELECT updated_at FROM snippets WHERE uuid = ?",
                    params![rec.uuid],
                    |row| row.get(0),
                )
                .optional()?;
            match existing {
                None => {
                    tx.execute(
                        "INSERT INTO snippets (uuid, title, description, code, language, tags, favorite, model, kind, copy_count, last_used_at, created_at, updated_at, deleted)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        params![
                            rec.uuid, rec.title, rec.description, rec.code, rec.language, tags_json,
                            rec.favorite as i64, rec.model, rec.kind, rec.copy_count, rec.last_used_at,
                            rec.created_at, rec.updated_at, rec.deleted as i64
                        ],
                    )?;
                    applied += 1;
                }
                Some(current) if rec.updated_at > current => {
                    tx.execute(
                        "UPDATE snippets SET title = ?, description = ?, code = ?, language = ?, tags = ?, favorite = ?, model = ?, kind = ?, copy_count = ?, last_used_at = ?, created_at = ?, updated_at = ?, deleted = ? WHERE uuid = ?",
                        params![
                            rec.title, rec.description, rec.code, rec.language, tags_json,
                            rec.favorite as i64, rec.model, rec.kind, rec.copy_count, rec.last_used_at,
                            rec.created_at, rec.updated_at, rec.deleted as i64, rec.uuid
                        ],
                    )?;
                    applied += 1;
                }
                _ => {}
            }
        }
        tx.commit()?;
        Ok(applied)
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
            db.get_all_snippets(Some(p), None, None, Some("all")).unwrap();
            db.get_all_snippets(None, Some(p), None, None).unwrap();
            db.get_all_snippets(None, None, Some(p), None).unwrap();
            db.get_all_snippets(Some(p), Some(p), Some(p), Some(p)).unwrap();
            assert!(table_exists(&db), "table dropped by read payload {p:?}");
        }
        // Both seed rows survive every payload.
        assert_eq!(db.get_all_snippets(None, None, None, None).unwrap().len(), 2);
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
            },
        )
        .unwrap();
        assert!(table_exists(&db));

        // The DROP string was stored literally — we can find it by title search.
        let hits = db
            .get_all_snippets(Some("drop table snippets"), None, None, Some("title"))
            .unwrap();
        assert!(
            hits.iter().any(|s| s.title.contains("DROP TABLE")),
            "payload was not stored as literal data"
        );

        // Seed + all payload rows + target row all still present.
        let total = db.get_all_snippets(None, None, None, None).unwrap().len();
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
            },
        )
        .unwrap();
        assert_eq!(db.get_snippet(a.id).unwrap().unwrap().kind, "code");

        // kind survives a sync round-trip (export → re-import into a fresh DB).
        let records = db.get_all_for_sync().unwrap();
        assert!(records.iter().any(|r| r.kind == "code"));
        let db2 = temp_db();
        db2.apply_sync_records(records).unwrap();
        let synced = db2.get_all_snippets(None, None, None, None).unwrap();
        assert!(synced.iter().any(|s| s.title == "snippet" && s.kind == "code"));
    }

    #[test]
    fn wildcard_payloads_match_literally_not_as_wildcards() {
        let db = temp_db();
        db.create_snippet(mk("alpha", "one")).unwrap();
        db.create_snippet(mk("beta", "two")).unwrap();
        // A search of "%" must NOT match everything — it's escaped to a literal %.
        let pct = db.get_all_snippets(Some("%"), None, None, Some("all")).unwrap();
        assert_eq!(pct.len(), 0, "'%' acted as a wildcard instead of a literal");
        let underscore = db.get_all_snippets(Some("_"), None, None, Some("all")).unwrap();
        assert_eq!(underscore.len(), 0, "'_' acted as a wildcard instead of a literal");
    }
}
