"use client";

import {
  Code2,
  Moon,
  Sun,
  Plus,
  Settings,
  Upload,
  Download,
  Trash2,
  BarChart3,
  RefreshCw,
  Loader2,
  CloudOff,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useSyncStore } from "@/hooks/use-sync";

// Compact relative time for the sync indicator ("2m ago"), kept short for the
// header chip rather than date-fns's longer "2 minutes ago".
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// The bottom-of-header sync chip. Only rendered on desktop with a configured
// server; reflects the shared sync store (spinner while syncing, error state,
// otherwise the last-synced time) and triggers a sync on click.
function SyncIndicator({ onSyncNow }: { onSyncNow: () => void }) {
  const sync = useSyncStore();
  const [, setTick] = useState(0);

  // Re-render periodically so "2m ago" stays current without a sync happening.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  const syncing = sync.status === "syncing";
  const errored = sync.status === "error";

  const label = syncing
    ? "Syncing…"
    : errored
      ? "Sync failed"
      : sync.lastSyncedAt
        ? `Synced ${timeAgo(sync.lastSyncedAt)}`
        : "Sync now";

  const title = errored
    ? sync.error
      ? `Sync failed: ${sync.error} — click to retry`
      : "Sync failed — click to retry"
    : "Sync with your server now";

  return (
    <button
      onClick={onSyncNow}
      disabled={syncing}
      title={title}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-70 ${
        errored
          ? "text-destructive hover:bg-destructive/10"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {syncing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : errored ? (
        <CloudOff className="h-3.5 w-3.5" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function Header({
  onNewSnippet,
  onImport,
  onExportLibrary,
  onOpenTrash,
  onOpenInsights,
  onOpenSettings,
  syncEnabled,
  onSyncNow,
}: {
  onNewSnippet: () => void;
  // Opens a file picker to import prompts from a JSON export.
  onImport: () => void;
  // Downloads the whole library as a JSON file.
  onExportLibrary?: () => void;
  // Opens the Trash (recently deleted) view.
  onOpenTrash?: () => void;
  // Opens the usage insights panel.
  onOpenInsights?: () => void;
  // Provided only in the desktop app; when set, a settings button is shown.
  onOpenSettings?: () => void;
  // Desktop + a configured sync server: show the last-synced indicator.
  syncEnabled?: boolean;
  onSyncNow?: () => void;
}) {
  // resolvedTheme reflects the actual applied theme (light/dark), including when
  // the preference is "system" — reading `theme` there gives "system", making
  // the icon wrong and the first toggle a no-op.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Code2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            SnipVault
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {syncEnabled && onSyncNow && <SyncIndicator onSyncNow={onSyncNow} />}
          <button
            onClick={onNewSnippet}
            title="New prompt or snippet (Ctrl/⌘+N)"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Prompt/Snippet
          </button>
          <button
            onClick={onImport}
            title="Import prompts from a JSON file"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Import prompts"
          >
            <Upload className="h-4 w-4" />
          </button>
          {onExportLibrary && (
            <button
              onClick={onExportLibrary}
              title="Export your whole library to a JSON file"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Export library"
            >
              <Download className="h-4 w-4" />
            </button>
          )}
          {onOpenInsights && (
            <button
              onClick={onOpenInsights}
              title="Usage insights"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Usage insights"
            >
              <BarChart3 className="h-4 w-4" />
            </button>
          )}
          {onOpenTrash && (
            <button
              onClick={onOpenTrash}
              title="Trash (recently deleted)"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Open trash"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          {mounted && (
            <button
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
