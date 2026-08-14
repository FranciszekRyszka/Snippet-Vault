"use client";

import { useEffect, useState } from "react";
import {
  X,
  FolderOpen,
  Save,
  Loader2,
  Check,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  Server,
  Plug,
  Unplug,
  Archive,
  RotateCcw,
  Palette,
  Keyboard,
  FileDown,
} from "lucide-react";
import {
  getDatabasePath,
  useExistingDb,
  backupDatabase,
  getBackupsDir,
  backupToFolder,
  restoreFromBackup,
  openBackupsDir,
  getBackupSettings,
  setBackupSettings,
  getSyncServer,
  saveSyncServer,
  removeSyncServer,
  getQuickCaptureSettings,
  setQuickCaptureSettings,
  getTrashRetentionDays,
  setTrashRetentionDays,
  getDeviceName,
  setDeviceName,
  isTauri,
  type SyncServer,
} from "@/lib/tauri-api";
import { AccentSwatches } from "./accent-picker";
import {
  getAutoSyncMinutes,
  setAutoSyncMinutes as persistAutoSyncMinutes,
  autoSyncLabel,
  AUTO_SYNC_OPTIONS,
} from "@/lib/auto-sync";
import { runSync as runSharedSync } from "@/hooks/use-sync";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import {
  checkForUpdate,
  relaunchApp,
  getAppVersion,
  isAutoUpdateEnabled,
  setAutoUpdateEnabled,
  type AvailableUpdate,
} from "@/lib/updater";

type SettingsDialogProps = {
  onClose: () => void;
  // Called when the active database changes, so the dashboard can reload.
  onDbChanged: () => void;
  // Library actions surfaced here (moved out of the header). Each closes
  // Settings first, then runs — see the dashboard wiring.
  onImport: () => void;
  onExportLibrary: () => void;
  onExportLibraryMarkdown: () => void;
  onOpenTrash: () => void;
  // Notify the dashboard when the background auto-sync interval changes, so it
  // can re-arm its timer immediately.
  onAutoSyncChange: (minutes: number) => void;
};

// Settings. The top sections (Library actions, Appearance) work everywhere; the
// database, sync-server, backup, and update sections are desktop-only and hidden
// on the web, where the Tauri commands they call don't exist.
export function SettingsDialog({
  onClose,
  onDbChanged,
  onImport,
  onExportLibrary,
  onExportLibraryMarkdown,
  onOpenTrash,
  onAutoSyncChange,
}: SettingsDialogProps) {
  // Freeze the page behind the dialog so scrolling here never moves it.
  useScrollLock();
  // Detected after mount to stay SSR-safe; the dialog only opens post-mount, so
  // the first render already has the right value in practice.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(isTauri()), []);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [backupsDir, setBackupsDir] = useState<string | null>(null);
  const [autoBackup, setAutoBackup] = useState(false);
  // Trash auto-purge retention (days; 0 = off) and this install's device name.
  const [trashDays, setTrashDays] = useState(0);
  const [deviceName, setDeviceNameState] = useState("");
  const [deviceSaved, setDeviceSaved] = useState(true);
  const [busy, setBusy] = useState<
    "change" | "backup" | "folder-backup" | "restore" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- Sync server ---
  const [server, setServer] = useState<SyncServer | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [syncBusy, setSyncBusy] = useState<"save" | "remove" | "sync" | null>(
    null
  );
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(0);

  // --- Quick capture (tray + global hotkey) ---
  const [quickEnabled, setQuickEnabled] = useState(true);
  const [quickShortcut, setQuickShortcut] = useState("");
  const [quickDefault, setQuickDefault] = useState("CmdOrCtrl+Shift+V");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickNotice, setQuickNotice] = useState<string | null>(null);

  // --- Updates ---
  const [version, setVersion] = useState<string>("");
  const [autoCheck, setAutoCheck] = useState(true);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updatePhase, setUpdatePhase] = useState<
    "idle" | "checking" | "up-to-date" | "available" | "installing" | "done"
  >("idle");
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // All of these are desktop-only (Tauri commands / desktop updater); don't
    // call them on the web, where they'd throw.
    if (!isTauri()) return;
    getDatabasePath().then(setDbPath).catch(() => setDbPath(null));
    getBackupsDir().then(setBackupsDir).catch(() => setBackupsDir(null));
    getBackupSettings()
      .then((s) => setAutoBackup(s.auto_backup))
      .catch(() => setAutoBackup(false));
    getTrashRetentionDays().then(setTrashDays).catch(() => setTrashDays(0));
    getDeviceName()
      .then((n) => {
        setDeviceNameState(n);
        setDeviceSaved(true);
      })
      .catch(() => setDeviceNameState(""));
    getAppVersion().then(setVersion).catch(() => setVersion(""));
    setAutoCheck(isAutoUpdateEnabled());
    getQuickCaptureSettings()
      .then((s) => {
        setQuickEnabled(s.enabled);
        setQuickShortcut(s.shortcut);
        setQuickDefault(s.default_shortcut);
      })
      .catch(() => {});
    setAutoSync(getAutoSyncMinutes());
    getSyncServer()
      .then((s) => {
        setServer(s);
        if (s) setUrlInput(s.url);
      })
      .catch(() => setServer(null));
  }, []);

  // Push local changes, pull the server's, then reload the dashboard's lists.
  // Goes through the shared sync store so the header indicator reflects a sync
  // started from here (spinner + last-synced time).
  const runSync = async () => {
    const result = await runSharedSync();
    onDbChanged();
    return result;
  };

  const handleSave = async () => {
    setSyncError(null);
    setSyncNotice(null);
    setSyncBusy("save");
    try {
      await saveSyncServer(urlInput, tokenInput);
      setServer(await getSyncServer());
      setTokenInput("");
      const { total } = await runSync();
      setSyncNotice(
        `Sync server saved — ${total} prompt${total === 1 ? "" : "s"} in your library.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncBusy(null);
    }
  };

  const handleSync = async () => {
    setSyncError(null);
    setSyncNotice(null);
    setSyncBusy("sync");
    try {
      const { total, applied } = await runSync();
      setSyncNotice(
        `Synced — ${applied} update${applied === 1 ? "" : "s"} pulled, ${total} prompt${
          total === 1 ? "" : "s"
        } total.`
      );
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncBusy(null);
    }
  };

  const handleRemove = async () => {
    setSyncError(null);
    setSyncNotice(null);
    setSyncBusy("remove");
    try {
      await removeSyncServer();
      setServer(null);
      setTokenInput("");
      onDbChanged();
      setSyncNotice("Sync server removed. Your local library is unchanged.");
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncBusy(null);
    }
  };

  const toggleAutoCheck = (enabled: boolean) => {
    setAutoCheck(enabled);
    setAutoUpdateEnabled(enabled);
  };

  // Enable/disable quick capture. Optimistic; reverts on failure.
  const toggleQuick = async (enabled: boolean) => {
    setQuickError(null);
    setQuickNotice(null);
    setQuickEnabled(enabled);
    setQuickBusy(true);
    try {
      const s = await setQuickCaptureSettings(enabled, quickShortcut || null);
      setQuickShortcut(s.shortcut);
      setQuickNotice(enabled ? "Quick capture enabled." : "Quick capture disabled.");
    } catch (err) {
      setQuickEnabled(!enabled);
      setQuickError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickBusy(false);
    }
  };

  // Save the (possibly edited) global hotkey. Rust validates + registers it
  // before persisting, so an invalid accelerator surfaces here and isn't saved.
  const saveQuickShortcut = async (shortcut: string) => {
    setQuickError(null);
    setQuickNotice(null);
    setQuickBusy(true);
    try {
      const s = await setQuickCaptureSettings(quickEnabled, shortcut || null);
      setQuickShortcut(s.shortcut);
      setQuickNotice(`Hotkey set to ${s.shortcut}.`);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuickBusy(false);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateError(null);
    setUpdatePhase("checking");
    try {
      const found = await checkForUpdate();
      if (found) {
        setUpdate(found);
        setUpdatePhase("available");
      } else {
        setUpdatePhase("up-to-date");
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdatePhase("idle");
    }
  };

  const handleInstallUpdate = async () => {
    if (!update) return;
    setUpdateError(null);
    setUpdatePhase("installing");
    try {
      await update.install((p) => setUpdatePercent(p));
      setUpdatePhase("done");
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdatePhase("available");
    }
  };

  const handleRelaunch = async () => {
    try {
      await relaunchApp();
    } catch (err) {
      // The update is installed; only the automatic restart failed.
      setUpdateError(err instanceof Error ? err.message : String(err));
    }
  };

  const timestampedName = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `snippets-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
      d.getDate()
    )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`;
  };

  const handleChange = async () => {
    setError(null);
    setNotice(null);
    setBusy("change");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Select a SnipVault database",
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      if (typeof selected !== "string") {
        setBusy(null);
        return;
      }
      const newPath = await useExistingDb(selected);
      setDbPath(newPath);
      setNotice("Database switched.");
      onDbChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleBackup = async () => {
    setError(null);
    setNotice(null);
    setBusy("backup");
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = await save({
        title: "Back up database",
        defaultPath: timestampedName(),
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (typeof dest !== "string") {
        setBusy(null);
        return;
      }
      await backupDatabase(dest);
      setNotice(`Backup saved to ${dest}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  // Write a timestamped snapshot into the managed backups folder (what external
  // backup tools watch). Keeps the newest few; older ones are pruned in Rust.
  const handleFolderBackup = async () => {
    setError(null);
    setNotice(null);
    setBusy("folder-backup");
    try {
      const path = await backupToFolder();
      setNotice(`Snapshot saved to ${path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleOpenBackups = async () => {
    setError(null);
    try {
      await openBackupsDir();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Toggle the opt-in launch backup. Optimistic; reverts on failure.
  const toggleAutoBackup = async (enabled: boolean) => {
    setAutoBackup(enabled);
    try {
      await setBackupSettings(enabled);
    } catch (err) {
      setAutoBackup(!enabled);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const changeTrashDays = async (days: number) => {
    const prev = trashDays;
    setTrashDays(days);
    try {
      await setTrashRetentionDays(days);
      // A retention change can purge old tombstones now — reload the lists.
      onDbChanged();
    } catch (err) {
      setTrashDays(prev);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveDevice = async () => {
    const cleaned = deviceName.trim().slice(0, 64);
    try {
      await setDeviceName(cleaned);
      setDeviceNameState(cleaned);
      setDeviceSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Restore the whole library from a backup file, replacing the current one.
  // Rust validates the file is a SnipVault database before anything changes.
  const handleRestore = async () => {
    setError(null);
    setNotice(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Restore from a backup",
        defaultPath: backupsDir ?? undefined,
        filters: [
          { name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] },
        ],
      });
      if (typeof selected !== "string") return;
      const ok = window.confirm(
        "Restore from this backup? It will replace your current library with the contents of the backup. This can't be undone."
      );
      if (!ok) return;
      setBusy("restore");
      await restoreFromBackup(selected);
      setNotice("Library restored from backup.");
      onDbChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5 overflow-y-auto overscroll-contain px-6 py-5">
          {/* Library — import, export, and Trash (moved here from the header). */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Library
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onImport}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Upload className="h-4 w-4" />
                Import…
              </button>
              <button
                type="button"
                onClick={onExportLibrary}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Download className="h-4 w-4" />
                Export JSON
              </button>
              <button
                type="button"
                onClick={onExportLibraryMarkdown}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <FileDown className="h-4 w-4" />
                Export Markdown
              </button>
              <button
                type="button"
                onClick={onOpenTrash}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                <Trash2 className="h-4 w-4" />
                Trash
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Import prompts from a JSON/.md/.txt file, export your whole library
              as <strong>JSON</strong> (re-importable) or a single
              <strong> Markdown</strong> document (readable/portable), or restore
              recently deleted prompts from Trash. You can also drag files onto the
              window to import.
            </p>
          </div>

          {/* Appearance — accent colour. */}
          <div className="border-t border-border pt-5">
            <label className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Palette className="h-4 w-4" />
              Accent color
            </label>
            <AccentSwatches />
          </div>

          {desktop && (
          <>
          <div className="border-t border-border pt-5">
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Server className="h-4 w-4" />
              Sync server
            </label>

            {server ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-start gap-1.5 break-all rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Syncing with{" "}
                  <span className="font-mono">{server.url}</span>
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleSync}
                    disabled={syncBusy !== null}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    {syncBusy === "sync" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Sync now
                  </button>
                  <button
                    type="button"
                    onClick={handleRemove}
                    disabled={syncBusy !== null}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {syncBusy === "remove" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Unplug className="h-4 w-4" />
                    )}
                    Remove server
                  </button>
                </div>

                <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <span>Auto-sync in the background</span>
                  <select
                    value={autoSync}
                    onChange={(e) => {
                      const minutes = Number(e.target.value);
                      setAutoSync(minutes);
                      persistAutoSyncMinutes(minutes);
                      onAutoSyncChange(minutes);
                    }}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {AUTO_SYNC_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {autoSyncLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  In addition to syncing on startup and when you tap Sync now, the
                  app can reconcile with the server on a timer while it&apos;s open.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Add a self-hosted server to keep one library in sync across
                  your computers. Your snippets stay stored locally and reconcile
                  with the server on startup and when you tap Sync now.
                </p>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="http://192.168.1.50:3000"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={syncBusy !== null}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <input
                  type="password"
                  autoComplete="off"
                  placeholder="Access token"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  disabled={syncBusy !== null}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={syncBusy !== null || !urlInput.trim() || !tokenInput}
                  className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {syncBusy === "save" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plug className="h-4 w-4" />
                  )}
                  Test &amp; save
                </button>
              </div>
            )}

            {syncNotice && (
              <p className="mt-2 flex items-start gap-1.5 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {syncNotice}
              </p>
            )}
            {syncError && (
              <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {syncError}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-5">
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Keyboard className="h-4 w-4" />
              Quick capture
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              A background tray icon and a global hotkey that pops up a small
              window to save a prompt — or find and copy one — without switching
              to SnipVault. Closing that window just hides it; quit from the tray.
            </p>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={quickEnabled}
                disabled={quickBusy}
                onChange={(e) => toggleQuick(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Enable the global hotkey
            </label>

            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder={quickDefault}
                value={quickShortcut}
                disabled={quickBusy || !quickEnabled}
                onChange={(e) => setQuickShortcut(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveQuickShortcut(quickShortcut);
                }}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => saveQuickShortcut(quickShortcut)}
                disabled={quickBusy || !quickEnabled}
                className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {quickBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Set hotkey
              </button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Use accelerator syntax like{" "}
              <span className="font-mono">{quickDefault}</span> —{" "}
              <span className="font-mono">CmdOrCtrl</span>,{" "}
              <span className="font-mono">Shift</span>,{" "}
              <span className="font-mono">Alt</span> plus a key. Leave blank to
              use the default.
            </p>

            {quickNotice && (
              <p className="mt-2 flex items-start gap-1.5 rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {quickNotice}
              </p>
            )}
            {quickError && (
              <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {quickError}
              </p>
            )}
          </div>

          <div className="border-t border-border pt-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Database location
            </label>
            <p className="break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
              {dbPath ?? "Loading…"}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleChange}
              disabled={busy !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {busy === "change" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
              Change database…
            </button>
            <button
              type="button"
              onClick={handleBackup}
              disabled={busy !== null}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === "backup" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Back up database…
            </button>
          </div>

          {notice && (
            <p className="flex items-start gap-1.5 break-all rounded-md bg-primary/10 px-3 py-2 text-xs text-primary">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {notice}
            </p>
          )}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="border-t border-border pt-5">
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Backups folder
            </label>
            <p className="mb-2 text-xs text-muted-foreground">
              Timestamped snapshots of your whole database, written consistently
              even while the app is running. Point an external backup tool
              (Databasus, restic, Time Machine, a cloud-sync folder…) at this
              folder — the newest snapshots are kept and older ones pruned.
            </p>
            <p className="break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
              {backupsDir ?? "Loading…"}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleFolderBackup}
                disabled={busy !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === "folder-backup" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                Back up now
              </button>
              <button
                type="button"
                onClick={handleOpenBackups}
                disabled={busy !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                <FolderOpen className="h-4 w-4" />
                Open folder
              </button>
              <button
                type="button"
                onClick={handleRestore}
                disabled={busy !== null}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {busy === "restore" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Restore…
              </button>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={autoBackup}
                onChange={(e) => toggleAutoBackup(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Automatically back up on launch (at most once a day)
            </label>
          </div>

          <div className="border-t border-border pt-5">
            <label className="block text-sm font-medium text-foreground">
              This device
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              A name for this install, stamped onto prompts it edits so you can
              tell your devices apart after syncing (shown in a prompt&rsquo;s
              details). Leave blank to record nothing.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={deviceName}
                maxLength={64}
                placeholder="e.g. Work laptop"
                onChange={(e) => {
                  setDeviceNameState(e.target.value);
                  setDeviceSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveDevice();
                }}
                className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={saveDevice}
                disabled={deviceSaved}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {deviceSaved ? "Saved" : "Save"}
              </button>
            </div>

            <label
              htmlFor="trash-retention"
              className="mt-4 block text-sm font-medium text-foreground"
            >
              Trash auto-purge
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              On launch, permanently clear the contents of items deleted longer
              ago than this. The deletion still syncs — only the old content is
              dropped, so it can&rsquo;t be recovered afterward.
            </p>
            <select
              id="trash-retention"
              value={trashDays}
              onChange={(e) => changeTrashDays(Number(e.target.value))}
              className="mt-2 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value={0}>Off — keep deleted items forever</option>
              <option value={7}>Clear after 7 days</option>
              <option value={30}>Clear after 30 days</option>
              <option value={90}>Clear after 90 days</option>
            </select>
          </div>

          <div className="border-t border-border pt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-foreground">
                Updates
              </label>
              {version && (
                <span className="text-xs text-muted-foreground">
                  Current version {version}
                </span>
              )}
            </div>

            <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={autoCheck}
                onChange={(e) => toggleAutoCheck(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Check for updates automatically on startup
            </label>

            {updatePhase === "done" ? (
              <button
                type="button"
                onClick={handleRelaunch}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <RefreshCw className="h-4 w-4" />
                Restart to finish updating
              </button>
            ) : updatePhase === "available" ? (
              <button
                type="button"
                onClick={handleInstallUpdate}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Download className="h-4 w-4" />
                Update to v{update?.version}
              </button>
            ) : updatePhase === "installing" ? (
              <button
                type="button"
                disabled
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-70"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {updatePercent === null
                  ? "Downloading…"
                  : `Downloading ${updatePercent}%`}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCheckUpdate}
                disabled={updatePhase === "checking"}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {updatePhase === "checking" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Check for updates
              </button>
            )}

            {updatePhase === "up-to-date" && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5" />
                You&apos;re on the latest version.
              </p>
            )}
            {updateError && (
              <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {updateError}
              </p>
            )}
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
