mod db;
mod validation;

use db::{Database, CreateSnippetInput, UpdateSnippetInput, Snippet};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Holds the currently opened database, if any. It stays `None` until the user
/// completes first-run setup (create new / choose existing).
struct AppState {
    db: Option<Database>,
}

/// A configured sync server. When present, the app works against this server
/// instead of the local database.
#[derive(Serialize, Deserialize, Default, Clone)]
struct RemoteConfig {
    url: String,
    token: String,
}

/// Persisted app configuration: the local database location and, optionally, a
/// sync server. Both can be set at once — the remote is what's *active*, and
/// clearing it falls back to the local database.
#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    db_path: Option<String>,
    #[serde(default)]
    remote: Option<RemoteConfig>,
}

/// Reported to the frontend on startup to decide whether to show first-run setup.
#[derive(Serialize)]
struct InitStatus {
    initialized: bool,
    db_path: Option<String>,
}

fn app_dir() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("snipvault")
}

fn config_path() -> PathBuf {
    app_dir().join("config.json")
}

fn default_db_path() -> PathBuf {
    app_dir().join("snippets.db")
}

fn load_config() -> AppConfig {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(cfg: &AppConfig) -> Result<(), String> {
    std::fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(), json).map_err(|e| e.to_string())
}

/// Open a database at `path`, store it in state, and remember the path in config.
fn set_active_db(state: &State<Mutex<AppState>>, path: &Path) -> Result<String, String> {
    let db = Database::open(path).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().into_owned();
    {
        let mut s = state.lock().map_err(|e| e.to_string())?;
        s.db = Some(db);
    }
    // Preserve any other config (e.g. a saved sync server) by editing the
    // loaded config rather than overwriting it with a db_path-only value.
    let mut cfg = load_config();
    cfg.db_path = Some(path_str.clone());
    save_config(&cfg)?;
    Ok(path_str)
}

// ---- Database setup / management commands ---------------------------------

#[tauri::command]
fn get_init_status(state: State<Mutex<AppState>>) -> Result<InitStatus, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(InitStatus {
        initialized: s.db.is_some(),
        db_path: s.db.as_ref().map(|d| d.path().to_string_lossy().into_owned()),
    })
}

/// Create a brand-new database. `path` is optional; when omitted the default
/// location (`<app data>/snipvault/snippets.db`) is used.
#[tauri::command]
fn initialize_new_db(state: State<Mutex<AppState>>, path: Option<String>) -> Result<String, String> {
    let target = match path {
        Some(p) if !p.trim().is_empty() => PathBuf::from(p),
        _ => default_db_path(),
    };
    set_active_db(&state, &target)
}

/// Adopt an existing database file the user already has.
#[tauri::command]
fn use_existing_db(state: State<Mutex<AppState>>, path: String) -> Result<String, String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("File does not exist: {path}"));
    }
    set_active_db(&state, &target)
}

#[tauri::command]
fn get_database_path(state: State<Mutex<AppState>>) -> Result<Option<String>, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    Ok(s.db.as_ref().map(|d| d.path().to_string_lossy().into_owned()))
}

/// Write a consistent copy of the current database to `destination`.
#[tauri::command]
fn backup_database(state: State<Mutex<AppState>>, destination: String) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let db = s.db.as_ref().ok_or("Database not initialized")?;
    let dest = PathBuf::from(&destination);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Refuse to back up onto the live database file. SQLite's online backup
    // would overwrite the source it is concurrently reading and corrupt the
    // only copy. Compare canonical paths so ".", symlinks, etc. can't sneak past;
    // fall back to the raw paths when the destination doesn't exist yet.
    let same_file = match (dest.canonicalize(), db.path().canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => dest == db.path(),
    };
    if same_file {
        return Err("Choose a different file — you can't back up onto the live database.".to_string());
    }
    db.backup_to(&dest).map_err(|e| e.to_string())?;
    Ok(destination)
}

// ---- Sync server (remote) configuration -----------------------------------

/// Return the saved sync server, if the app is configured to use one. The
/// frontend uses this to decide between remote and local mode at startup.
#[tauri::command]
fn get_remote_config() -> Result<Option<RemoteConfig>, String> {
    Ok(load_config().remote)
}

/// Save the sync server to use. `url` is normalized (trailing slash trimmed).
/// The local db_path is left untouched so disconnecting can fall back to it.
#[tauri::command]
fn set_remote_config(url: String, token: String) -> Result<(), String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("Server URL is required".to_string());
    }
    let mut cfg = load_config();
    cfg.remote = Some(RemoteConfig { url, token });
    save_config(&cfg)
}

/// Forget the sync server and return to local mode.
#[tauri::command]
fn clear_remote_config() -> Result<(), String> {
    let mut cfg = load_config();
    cfg.remote = None;
    save_config(&cfg)
}

// ---- Snippet CRUD commands ------------------------------------------------

#[tauri::command]
fn get_snippets(
    state: State<Mutex<AppState>>,
    search: Option<String>,
    language: Option<String>,
    tag: Option<String>,
    search_mode: Option<String>,
) -> Result<Vec<Snippet>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.get_all_snippets(
        search.as_deref(),
        language.as_deref(),
        tag.as_deref(),
        search_mode.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_snippet(state: State<Mutex<AppState>>, input: CreateSnippetInput) -> Result<Snippet, String> {
    let input = validation::sanitize_create(input)?;
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.create_snippet(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_snippet(state: State<Mutex<AppState>>, id: i64, input: UpdateSnippetInput) -> Result<Option<Snippet>, String> {
    let input = validation::sanitize_update(input)?;
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.update_snippet(id, input).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_snippet(state: State<Mutex<AppState>>, id: i64) -> Result<bool, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.delete_snippet(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_favorite(state: State<Mutex<AppState>>, id: i64, favorite: bool) -> Result<Option<Snippet>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.set_favorite(id, favorite).map_err(|e| e.to_string())
}

#[tauri::command]
fn record_copy(state: State<Mutex<AppState>>, id: i64) -> Result<Option<Snippet>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.record_copy(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn restore_snippet(state: State<Mutex<AppState>>, snippet: Snippet) -> Result<Snippet, String> {
    let snippet = validation::sanitize_restore(snippet)?;
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.restore_snippet(snippet).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Decide which database (if any) to open on startup.
    let cfg = load_config();
    let mut app_state = AppState { db: None };

    let startup_path = match &cfg.db_path {
        Some(p) => Some(PathBuf::from(p)),
        // Back-compat: if there's no config yet but a database already exists at
        // the default location (installs from before this feature), adopt it so
        // existing users aren't prompted to set up again.
        None => {
            let d = default_db_path();
            if d.exists() { Some(d) } else { None }
        }
    };

    if let Some(path) = startup_path {
        if path.exists() {
            if let Ok(db) = Database::open(&path) {
                app_state.db = Some(db);
                // Persist the path if it was only inferred (no config yet),
                // keeping any other fields already in the config.
                if cfg.db_path.is_none() {
                    let mut merged = load_config();
                    merged.db_path = Some(path.to_string_lossy().into_owned());
                    let _ = save_config(&merged);
                }
            }
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .manage(Mutex::new(app_state))
        .invoke_handler(tauri::generate_handler![
            get_snippets,
            create_snippet,
            update_snippet,
            delete_snippet,
            set_favorite,
            record_copy,
            restore_snippet,
            get_init_status,
            initialize_new_db,
            use_existing_db,
            get_database_path,
            backup_database,
            get_remote_config,
            set_remote_config,
            clear_remote_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
