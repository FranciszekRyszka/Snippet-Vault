use rusqlite::{Connection, DatabaseName, Result, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub code: String,
    pub language: String,
    pub tags: Vec<String>,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateSnippetInput {
    pub title: String,
    pub description: Option<String>,
    pub code: String,
    pub language: String,
    pub tags: Option<Vec<String>>,
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

        // Enable WAL mode for better concurrency
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;

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
        
        let mut sql = String::from("SELECT id, title, description, code, language, tags, created_at, updated_at FROM snippets WHERE 1=1");
        let mut params_vec: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        
        if let Some(lang) = language {
            if !lang.is_empty() {
                sql.push_str(" AND language = ?");
                params_vec.push(Box::new(lang.to_string()));
            }
        }
        
        if let Some(t) = tag {
            if !t.is_empty() {
                sql.push_str(" AND tags LIKE ?");
                params_vec.push(Box::new(format!("%\"{}%", t)));
            }
        }
        
        if let Some(s) = search {
            if !s.is_empty() {
                let search_pattern = format!("%{}%", s.to_lowercase());
                let mode = search_mode.unwrap_or("all");
                
                match mode {
                    "title" => {
                        sql.push_str(" AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ?)");
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern));
                    }
                    "tags" => {
                        sql.push_str(" AND LOWER(tags) LIKE ?");
                        params_vec.push(Box::new(search_pattern));
                    }
                    _ => {
                        sql.push_str(" AND (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?)");
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern.clone()));
                        params_vec.push(Box::new(search_pattern));
                    }
                }
            }
        }
        
        sql.push_str(" ORDER BY created_at DESC");
        
        let params_refs: Vec<&dyn rusqlite::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
        
        let mut stmt = conn.prepare(&sql)?;
        let snippet_iter = stmt.query_map(params_refs.as_slice(), |row| {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            
            Ok(Snippet {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                code: row.get(3)?,
                language: row.get(4)?,
                tags,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        
        let mut snippets = Vec::new();
        for snippet in snippet_iter {
            snippets.push(snippet?);
        }
        
        Ok(snippets)
    }
    
    pub fn get_snippet(&self, id: i64) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, title, description, code, language, tags, created_at, updated_at FROM snippets WHERE id = ?"
        )?;
        
        let mut rows = stmt.query(params![id])?;
        
        if let Some(row) = rows.next()? {
            let tags_json: String = row.get(5)?;
            let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();
            
            Ok(Some(Snippet {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                code: row.get(3)?,
                language: row.get(4)?,
                tags,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }
    
    pub fn create_snippet(&self, input: CreateSnippetInput) -> Result<Snippet> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&input.tags.unwrap_or_default()).unwrap_or_else(|_| "[]".to_string());
        let description = input.description.unwrap_or_default();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        
        conn.execute(
            "INSERT INTO snippets (title, description, code, language, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![input.title, description, input.code, input.language, tags_json, now, now],
        )?;
        
        let id = conn.last_insert_rowid();
        drop(conn);
        
        self.get_snippet(id).map(|s| s.unwrap())
    }
    
    pub fn update_snippet(&self, id: i64, input: UpdateSnippetInput) -> Result<Option<Snippet>> {
        let conn = self.conn.lock().unwrap();
        let tags_json = serde_json::to_string(&input.tags.unwrap_or_default()).unwrap_or_else(|_| "[]".to_string());
        let description = input.description.unwrap_or_default();
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        
        let rows_affected = conn.execute(
            "UPDATE snippets SET title = ?, description = ?, code = ?, language = ?, tags = ?, updated_at = ? WHERE id = ?",
            params![input.title, description, input.code, input.language, tags_json, now, id],
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
}
