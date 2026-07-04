use rusqlite::{Connection, DatabaseName, Result, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The full column list, in the order `row_to_snippet` expects. Kept in one
/// place so every SELECT stays in sync with the row mapper.
const SNIPPET_COLUMNS: &str =
    "id, title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at";

/// Escape LIKE metacharacters so user input matches literally. Must be paired
/// with an `ESCAPE '\'` clause on the LIKE. Without this, a search or tag value
/// containing `%` or `_` would act as a wildcard (e.g. `%` matches everything).
fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub code: String,
    pub language: String,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub model: String,
    pub copy_count: i64,
    pub last_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSnippetInput {
    pub title: String,
    pub description: Option<String>,
    pub code: String,
    pub language: String,
    pub tags: Option<Vec<String>>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSnippetInput {
    pub title: String,
    pub description: Option<String>,
    pub code: String,
    pub language: String,
    pub tags: Option<Vec<String>>,
    pub model: Option<String>,
}

/// Map a row selected with `SNIPPET_COLUMNS` into a `Snippet`.
fn row_to_snippet(row: &rusqlite::Row) -> Result<Snippet> {
    let tags_json: String = row.get(5)?;
    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
    let favorite: i64 = row.get(6)?;

    Ok(Snippet {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        code: row.get(3)?,
        language: row.get(4)?,
        tags,
        favorite: favorite != 0,
        model: row.get(7)?,
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

        let mut sql = format!("SELECT {SNIPPET_COLUMNS} FROM snippets WHERE 1=1");
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
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        conn.execute(
            "INSERT INTO snippets (title, description, code, language, tags, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![input.title, description, input.code, input.language, tags_json, model, now, now],
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
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        let rows_affected = conn.execute(
            "UPDATE snippets SET title = ?, description = ?, code = ?, language = ?, tags = ?, model = ?, updated_at = ? WHERE id = ?",
            params![input.title, description, input.code, input.language, tags_json, model, now, id],
        )?;

        drop(conn);

        if rows_affected > 0 {
            self.get_snippet(id)
        } else {
            Ok(None)
        }
    }

    pub fn delete_snippet(&self, id: i64) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let rows_affected = conn.execute("DELETE FROM snippets WHERE id = ?", params![id])?;
        Ok(rows_affected > 0)
    }

    /// Pin/unpin a snippet. Returns the updated snippet, or `None` if not found.
    pub fn set_favorite(&self, id: i64, favorite: bool) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let rows_affected = conn.execute(
            "UPDATE snippets SET favorite = ? WHERE id = ?",
            params![favorite as i64, id],
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

    /// Re-insert a previously deleted snippet, preserving all its fields
    /// (favorite, model, usage counts, timestamps). Used by undo-after-delete.
    /// The restored row gets a new autoincrement id.
    pub fn restore_snippet(&self, s: Snippet) -> Result<Snippet> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO snippets (title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                s.title, s.description, s.code, s.language, tags_json,
                s.favorite as i64, s.model, s.copy_count, s.last_used_at, s.created_at, s.updated_at
            ],
        )?;

        let id = conn.last_insert_rowid();
        drop(conn);

        self.get_snippet(id)?
            .ok_or_else(|| rusqlite::Error::QueryReturnedNoRows)
    }
}
