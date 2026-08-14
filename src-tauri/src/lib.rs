mod db;
mod validation;

use db::{Database, CreateSnippetInput, UpdateSnippetInput, Snippet, SnippetRevision, SyncRecord};
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
#[derive(Serialize, Deserialize)]
struct AppConfig {
    db_path: Option<String>,
    #[serde(default)]
    remote: Option<RemoteConfig>,
    /// Opt-in: write a snapshot into the backups folder on launch (at most once a
    /// day). Off by default.
    #[serde(default)]
    auto_backup: bool,
    /// How many snapshots to keep when pruning. 0 means "unset" → the default.
    #[serde(default)]
    backup_keep: u32,
    /// Whether the global quick-capture hotkey + tray shortcut are active. On by
    /// default (also for configs written before this field existed).
    #[serde(default = "default_true")]
    quick_capture_enabled: bool,
    /// The global hotkey accelerator (e.g. "CmdOrCtrl+Shift+V"). `None` → the
    /// built-in default.
    #[serde(default)]
    quick_capture_shortcut: Option<String>,
    /// Auto-purge Trash: on launch, blank the content of tombstones deleted more
    /// than this many days ago (keeping the tombstone for sync). 0 = off.
    #[serde(default)]
    trash_retention_days: u32,
    /// A friendly name for this install, stamped onto rows this device writes so
    /// other devices can see where an edit came from. Empty = unset.
    #[serde(default)]
    device_name: String,
}

// A hand-written Default (rather than derive) so a brand-new install — where
// load_config() falls back to Default — gets quick capture ON, matching the
// serde field default used for existing configs that predate the field.
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            db_path: None,
            remote: None,
            auto_backup: false,
            backup_keep: 0,
            quick_capture_enabled: true,
            quick_capture_shortcut: None,
            trash_retention_days: 0,
            device_name: String::new(),
        }
    }
}

fn default_true() -> bool {
    true
}

/// Default number of rotating snapshots to keep.
fn default_backup_keep() -> u32 {
    10
}

/// The built-in quick-capture hotkey when the user hasn't chosen one.
const DEFAULT_QUICK_SHORTCUT: &str = "CmdOrCtrl+Shift+V";

/// The effective quick-capture accelerator: the user's choice, or the default.
fn resolved_quick_shortcut(cfg: &AppConfig) -> String {
    cfg.quick_capture_shortcut
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_QUICK_SHORTCUT.to_string())
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
    // Carry the configured device name onto the freshly opened db so writes made
    // this session are stamped (matches what the startup path does).
    db.set_device(&load_config().device_name);
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

// ---- Whole-database backup to a managed folder ----------------------------
//
// A stable, documented folder (`<app data>/snipvault/backups/`) that holds
// timestamped, consistent copies of the whole database — the kind external
// backup tools (Databasus, restic, Time Machine, a cloud-sync folder, cron) can
// safely watch. Each snapshot goes through SQLite's online backup API, so it's
// never a torn mid-write copy even in WAL mode.

fn backups_dir() -> PathBuf {
    app_dir().join("backups")
}

/// A filesystem-friendly local timestamp, e.g. `20260809-181245`. Sorts
/// lexically in chronological order, which the pruning below relies on.
fn backup_timestamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Whether a snapshot was written in the last 24 hours — used to throttle the
/// opt-in launch backup to at most once a day.
fn backed_up_within_24h(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let now = std::time::SystemTime::now();
    entries.flatten().any(|e| {
        let is_snapshot = e
            .file_name()
            .to_str()
            .map(|n| n.starts_with("snipvault-") && n.ends_with(".db"))
            .unwrap_or(false);
        is_snapshot
            && e
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| now.duration_since(t).ok())
                .map(|age| age.as_secs() < 24 * 3600)
                .unwrap_or(false)
    })
}

/// Write a timestamped snapshot of `db` into the backups folder and prune to the
/// newest `keep`. Shared by the manual command and the launch auto-backup.
fn write_snapshot(db: &Database, keep: u32) -> Result<PathBuf, String> {
    let dir = backups_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("snipvault-{}.db", backup_timestamp()));
    db.backup_to(&dest).map_err(|e| e.to_string())?;
    prune_backups(&dir, keep.max(1) as usize);
    Ok(dest)
}

/// Keep only the newest `keep` snapshots in `dir`, deleting older ones. Names
/// sort chronologically, so ascending order puts the oldest first.
fn prune_backups(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("snipvault-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();
    if files.len() > keep {
        let excess = files.len() - keep;
        for old in files.into_iter().take(excess) {
            let _ = std::fs::remove_file(old);
        }
    }
}

/// The managed backups folder path (created if missing) — shown in Settings so
/// the user knows where to point an external backup tool.
#[tauri::command]
fn get_backups_dir() -> Result<String, String> {
    let dir = backups_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Write a timestamped, consistent snapshot of the whole database into the
/// managed backups folder, then prune to the newest `keep` (default 10).
/// Returns the path written.
#[tauri::command]
fn backup_to_folder(state: State<Mutex<AppState>>, keep: Option<u32>) -> Result<String, String> {
    let s = state.lock().map_err(|e| e.to_string())?;
    let db = s.db.as_ref().ok_or("Database not initialized")?;
    let keep = keep.unwrap_or_else(default_backup_keep);
    let dest = write_snapshot(db, keep)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// The opt-in automatic-backup settings, for the Settings UI.
#[derive(Serialize)]
struct BackupSettings {
    auto_backup: bool,
    keep: u32,
}

#[tauri::command]
fn get_backup_settings() -> BackupSettings {
    let cfg = load_config();
    BackupSettings {
        auto_backup: cfg.auto_backup,
        keep: if cfg.backup_keep == 0 {
            default_backup_keep()
        } else {
            cfg.backup_keep
        },
    }
}

/// Enable/disable the launch auto-backup and set how many snapshots to keep.
#[tauri::command]
fn set_backup_settings(auto_backup: bool, keep: Option<u32>) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.auto_backup = auto_backup;
    cfg.backup_keep = match keep {
        Some(k) => k.max(1),
        None if cfg.backup_keep == 0 => default_backup_keep(),
        None => cfg.backup_keep,
    };
    save_config(&cfg)
}

/// The Trash auto-purge retention, in days (0 = off/keep forever).
#[tauri::command]
fn get_trash_retention_days() -> u32 {
    load_config().trash_retention_days
}

/// Set the Trash auto-purge retention (days; 0 = off). Applies on the next
/// launch; also runs once now so the change takes effect immediately.
#[tauri::command]
fn set_trash_retention_days(
    state: State<Mutex<AppState>>,
    days: u32,
) -> Result<(), String> {
    let mut cfg = load_config();
    cfg.trash_retention_days = days;
    save_config(&cfg)?;
    if days > 0 {
        let s = state.lock().map_err(|e| e.to_string())?;
        if let Some(db) = s.db.as_ref() {
            let _ = db.purge_deleted_older_than(days as i64);
        }
    }
    Ok(())
}

/// This install's device name (stamped onto rows it writes; "" = unset).
#[tauri::command]
fn get_device_name() -> String {
    load_config().device_name
}

/// Set this install's device name. Persists it and applies it to the live
/// database so subsequent writes are stamped without a restart.
#[tauri::command]
fn set_device_name(state: State<Mutex<AppState>>, name: String) -> Result<(), String> {
    let cleaned: String = name.trim().chars().take(64).collect();
    let mut cfg = load_config();
    cfg.device_name = cleaned.clone();
    save_config(&cfg)?;
    let s = state.lock().map_err(|e| e.to_string())?;
    if let Some(db) = s.db.as_ref() {
        db.set_device(&cleaned);
    }
    Ok(())
}

/// Restore the whole database from a backup file, replacing the current
/// library. The file is validated as a SnipVault database first, so an
/// unrelated or corrupt file can't clobber the live data. Uses SQLite's online
/// restore API, so open connections keep working.
#[tauri::command]
fn restore_from_backup(state: State<Mutex<AppState>>, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("File does not exist: {path}"));
    }
    if !db::looks_like_snipvault_db(&src) {
        return Err(
            "That file doesn't look like a SnipVault database — restore cancelled.".to_string(),
        );
    }
    let s = state.lock().map_err(|e| e.to_string())?;
    let db = s.db.as_ref().ok_or("Database not initialized")?;
    // Don't restore the live file onto itself.
    let same_file = match (src.canonicalize(), db.path().canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => src == db.path(),
    };
    if same_file {
        return Err("That's the current database, not a backup.".to_string());
    }
    db.restore_from(&src).map_err(|e| e.to_string())
}

/// Open the managed backups folder in the OS file manager, so the user can grab
/// a snapshot or point a backup tool at it.
#[tauri::command]
fn open_backups_dir() -> Result<(), String> {
    let dir = backups_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "linux")]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(dir.as_os_str())
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---- Sync server (remote) configuration -----------------------------------

// The sync token is a secret, so it's kept in the OS credential store (Windows
// Credential Manager / macOS Keychain / Linux Secret Service) rather than in the
// plaintext config.json. `config.json` holds only the server URL. When the OS
// store is unavailable (e.g. a headless Linux box with no Secret Service), the
// token falls back to config.json so sync still works — just less privately.
const KEYRING_SERVICE: &str = "snipvault";
const KEYRING_ACCOUNT: &str = "sync-token";

fn keyring_entry() -> Option<keyring::Entry> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).ok()
}

/// Store the token in the OS credential store. Returns true on success; false if
/// no store is available (caller then falls back to config.json).
fn store_token_in_keyring(token: &str) -> bool {
    keyring_entry()
        .map(|e| e.set_password(token).is_ok())
        .unwrap_or(false)
}

/// Read the token from the OS credential store, if one is set there. `None` for
/// "not set" (Error::NoEntry) or "no store available".
fn read_token_from_keyring() -> Option<String> {
    keyring_entry().and_then(|e| e.get_password().ok())
}

fn delete_token_from_keyring() {
    if let Some(entry) = keyring_entry() {
        // Ignore "nothing to delete"; the goal is just that no token remains.
        let _ = entry.delete_credential();
    }
}

/// Return the saved sync server, if the app is configured to use one. The
/// frontend uses this to decide between remote and local mode at startup, and it
/// still receives the token inline (`RemoteConfig`) — the on-disk location is an
/// implementation detail. A legacy plaintext token found in config.json is
/// migrated into the OS store on read and blanked in the file.
#[tauri::command]
fn get_remote_config() -> Result<Option<RemoteConfig>, String> {
    let cfg = load_config();
    let Some(mut remote) = cfg.remote else {
        return Ok(None);
    };

    if let Some(token) = read_token_from_keyring() {
        // Normal path: the secret lives in the OS store.
        remote.token = token;
    } else if !remote.token.is_empty() {
        // Legacy config with a plaintext token: migrate it into the OS store and
        // blank the file copy. If the store is unavailable, leave it in the file
        // so sync keeps working. Either way return it so this session works.
        if store_token_in_keyring(&remote.token) {
            // Re-load and edit in place so other fields (db_path, backup
            // settings) are preserved, then blank just the file's token copy.
            let mut migrated = load_config();
            migrated.remote = Some(RemoteConfig {
                url: remote.url.clone(),
                token: String::new(),
            });
            let _ = save_config(&migrated);
        }
    }

    Ok(Some(remote))
}

/// Save the sync server to use. `url` is normalized (trailing slash trimmed).
/// The token goes to the OS credential store; only the URL is written to
/// config.json (with the token blanked) unless no store is available, in which
/// case the token is kept in the file as a fallback. The local db_path is left
/// untouched so disconnecting can fall back to it.
#[tauri::command]
fn set_remote_config(url: String, token: String) -> Result<(), String> {
    let url = url.trim().trim_end_matches('/').to_string();
    if url.is_empty() {
        return Err("Server URL is required".to_string());
    }
    let stored = store_token_in_keyring(&token);
    let mut cfg = load_config();
    cfg.remote = Some(RemoteConfig {
        url,
        // Blank the file copy when the secret is safely in the OS store; keep it
        // only as a fallback when no store is available.
        token: if stored { String::new() } else { token },
    });
    save_config(&cfg)
}

/// Forget the sync server and return to local mode. Removes both the OS-store
/// token and the config entry.
#[tauri::command]
fn clear_remote_config() -> Result<(), String> {
    delete_token_from_keyring();
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
    sort: Option<String>,
) -> Result<Vec<Snippet>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.get_all_snippets(
        search.as_deref(),
        language.as_deref(),
        tag.as_deref(),
        search_mode.as_deref(),
        sort.as_deref(),
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_deleted(state: State<Mutex<AppState>>) -> Result<Vec<Snippet>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.get_deleted().map_err(|e| e.to_string())
}

/// Empty the Trash — blank every tombstone's content (keeping the tombstone for
/// sync). Returns how many were purged.
#[tauri::command]
fn purge_deleted(state: State<Mutex<AppState>>) -> Result<i64, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.purge_deleted().map_err(|e| e.to_string())
}

/// Rename, merge, or delete a tag library-wide. `to = None` deletes it; renaming
/// onto an existing tag merges them. Returns how many rows changed.
#[tauri::command]
fn rewrite_tag(
    state: State<Mutex<AppState>>,
    from: String,
    to: Option<String>,
) -> Result<i64, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.rewrite_tag(&from, to.as_deref()).map_err(|e| e.to_string())
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

/// Past versions of a snippet (by its stable `uuid`), newest first. Local-only.
#[tauri::command]
fn get_revisions(state: State<Mutex<AppState>>, uuid: String) -> Result<Vec<SnippetRevision>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.get_revisions(&uuid).map_err(|e| e.to_string())
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

// ---- Sync commands --------------------------------------------------------

/// Read the entire local library (including tombstones) to push to the server.
#[tauri::command]
fn get_all_for_sync(state: State<Mutex<AppState>>) -> Result<Vec<SyncRecord>, String> {
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.get_all_for_sync().map_err(|e| e.to_string())
}

/// Merge the server's records back into the local library (newest edit wins).
/// Returns how many local rows were inserted or updated.
#[tauri::command]
fn apply_sync_records(state: State<Mutex<AppState>>, records: Vec<SyncRecord>) -> Result<i64, String> {
    // Clamp every record the server hands back before it touches the local DB,
    // mirroring the server's own ingress normalization. A hostile/MITM'd server
    // is otherwise trusted here, so this bounds field sizes and rejects bogus
    // timestamps that would corrupt the newest-wins merge.
    let records: Vec<SyncRecord> = records
        .into_iter()
        .map(validation::sanitize_sync_record)
        .collect();
    let state = state.lock().map_err(|e| e.to_string())?;
    let db = state.db.as_ref().ok_or("Database not initialized")?;
    db.apply_sync_records(records).map_err(|e| e.to_string())
}

// ---- Quick capture: tray, global hotkey, and the pop-up window ------------
//
// A background presence (system tray) plus a global hotkey that summons a small
// always-on-top "quick capture" window — paste-and-save a prompt, or fuzzy-find
// and copy one, without switching to the full app. The window is a second
// webview that loads the same frontend bundle and branches on its window label
// (`quick`). Desktop-only; the whole surface is `#[cfg(desktop)]`.

/// The quick-capture settings surfaced to the Settings UI.
#[derive(Serialize)]
struct QuickCaptureSettings {
    enabled: bool,
    shortcut: String,
    default_shortcut: String,
}

fn quick_capture_settings(cfg: &AppConfig) -> QuickCaptureSettings {
    QuickCaptureSettings {
        enabled: cfg.quick_capture_enabled,
        shortcut: resolved_quick_shortcut(cfg),
        default_shortcut: DEFAULT_QUICK_SHORTCUT.to_string(),
    }
}

#[tauri::command]
fn get_quick_capture_settings() -> QuickCaptureSettings {
    quick_capture_settings(&load_config())
}

/// Enable/disable quick capture and set the global hotkey. The new hotkey is
/// registered *before* the settings are saved, so an invalid accelerator is
/// reported and nothing is persisted. Returns the resolved settings.
#[tauri::command]
fn set_quick_capture_settings(
    app: tauri::AppHandle,
    enabled: bool,
    shortcut: Option<String>,
) -> Result<QuickCaptureSettings, String> {
    let mut cfg = load_config();
    cfg.quick_capture_enabled = enabled;
    cfg.quick_capture_shortcut = shortcut
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let resolved = resolved_quick_shortcut(&cfg);

    #[cfg(desktop)]
    apply_global_shortcut(&app, enabled, &resolved)?;
    #[cfg(not(desktop))]
    let _ = &app;

    save_config(&cfg)?;
    Ok(quick_capture_settings(&cfg))
}

/// Register (or clear) the quick-capture global hotkey. Always clears the
/// previous registration first so switching hotkeys doesn't leave a stale one.
#[cfg(desktop)]
fn apply_global_shortcut(
    app: &tauri::AppHandle,
    enabled: bool,
    shortcut: &str,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if enabled {
        gs.register(shortcut)
            .map_err(|e| format!("Couldn't register the shortcut \"{shortcut}\": {e}"))?;
    }
    Ok(())
}

/// Get the quick-capture window, creating it (hidden) on first use. It loads the
/// same bundle as the main window; the frontend branches on the `quick` label.
#[cfg(desktop)]
fn quick_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("quick") {
        return Ok(w);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        "quick",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Quick capture — SnipVault")
    .inner_size(640.0, 460.0)
    .min_inner_size(460.0, 320.0)
    .always_on_top(true)
    .center()
    .skip_taskbar(true)
    .visible(false)
    .build()
}

/// Show + focus the quick-capture window.
#[cfg(desktop)]
fn show_quick_window(app: &tauri::AppHandle) {
    match quick_window(app) {
        Ok(w) => {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("[SnipVault] quick-capture window error: {e}"),
    }
}

/// Toggle the quick-capture window: hide it if it's up, otherwise show + focus.
#[cfg(desktop)]
fn toggle_quick_window(app: &tauri::AppHandle) {
    match quick_window(app) {
        Ok(w) => {
            if w.is_visible().unwrap_or(false) {
                let _ = w.hide();
            } else {
                let _ = w.center();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
        Err(e) => eprintln!("[SnipVault] quick-capture window error: {e}"),
    }
}

/// Bring the main window to the foreground (from the tray).
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
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
                // Name this device so local writes are stamped (for the sync
                // "last edited on…" hint). Empty name → rows keep "" (unknown).
                db.set_device(&cfg.device_name);
                // Opt-in launch backup: write one snapshot if enabled and none
                // was taken in the last day. Best-effort — a backup failure must
                // never block the app from starting.
                if cfg.auto_backup && !backed_up_within_24h(&backups_dir()) {
                    let keep = if cfg.backup_keep == 0 {
                        default_backup_keep()
                    } else {
                        cfg.backup_keep
                    };
                    let _ = write_snapshot(&db, keep);
                }
                // Opt-in Trash auto-purge: blank the content of tombstones older
                // than the retention window (keeping them for sync). Best-effort.
                if cfg.trash_retention_days > 0 {
                    let _ = db.purge_deleted_older_than(cfg.trash_retention_days as i64);
                }
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
        .plugin(tauri_plugin_opener::init())
        // Closing the quick-capture window just hides it (the tray/hotkey bring
        // it back); it never quits the app or is destroyed.
        .on_window_event(|window, event| {
            if window.label() == "quick" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri_plugin_global_shortcut::ShortcutState;

                // Global hotkey: one handler that toggles the quick-capture window
                // whenever the (single) registered shortcut is pressed.
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(|app, _shortcut, event| {
                            if event.state() == ShortcutState::Pressed {
                                toggle_quick_window(app);
                            }
                        })
                        .build(),
                )?;

                let cfg = load_config();
                if cfg.quick_capture_enabled {
                    let shortcut = resolved_quick_shortcut(&cfg);
                    if let Err(e) = apply_global_shortcut(app.handle(), true, &shortcut) {
                        // A bad saved accelerator shouldn't stop the app from
                        // launching — log it and carry on (the tray still works).
                        eprintln!("[SnipVault] {e}");
                    }
                }

                // System tray: left-click opens the main window; the menu offers
                // quick capture, open, and quit.
                let quick_item =
                    MenuItemBuilder::with_id("quick", "Quick capture").build(app)?;
                let show_item =
                    MenuItemBuilder::with_id("show", "Open SnipVault").build(app)?;
                let sep = PredefinedMenuItem::separator(app)?;
                let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
                let menu = MenuBuilder::new(app)
                    .items(&[&quick_item, &show_item, &sep, &quit_item])
                    .build()?;

                let mut tray = TrayIconBuilder::with_id("main-tray")
                    .tooltip("SnipVault")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "quick" => show_quick_window(app),
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main_window(tray.app_handle());
                        }
                    });
                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }
                tray.build(app)?;
            }
            Ok(())
        })
        .manage(Mutex::new(app_state))
        .invoke_handler(tauri::generate_handler![
            get_snippets,
            get_deleted,
            purge_deleted,
            create_snippet,
            update_snippet,
            rewrite_tag,
            get_revisions,
            delete_snippet,
            set_favorite,
            record_copy,
            restore_snippet,
            get_init_status,
            initialize_new_db,
            use_existing_db,
            get_database_path,
            backup_database,
            get_backups_dir,
            backup_to_folder,
            get_backup_settings,
            set_backup_settings,
            get_trash_retention_days,
            set_trash_retention_days,
            get_device_name,
            set_device_name,
            restore_from_backup,
            open_backups_dir,
            get_remote_config,
            set_remote_config,
            clear_remote_config,
            get_all_for_sync,
            apply_sync_records,
            get_quick_capture_settings,
            set_quick_capture_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
