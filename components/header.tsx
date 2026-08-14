"use client";

import {
  Code2,
  Moon,
  Sun,
  Plus,
  Settings,
  BarChart3,
  RefreshCw,
  Loader2,
  CloudOff,
  ChevronDown,
  FileText,
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
  onOpenInsights,
  onOpenSettings,
  syncEnabled,
  onSyncNow,
  templates = [],
  onNewFromTemplate,
}: {
  onNewSnippet: () => void;
  // Opens the usage insights panel.
  onOpenInsights?: () => void;
  // Opens Settings — which now also holds Import / Export / Trash / Accent.
  onOpenSettings?: () => void;
  // Desktop + a configured sync server: show the last-synced indicator.
  syncEnabled?: boolean;
  onSyncNow?: () => void;
  // Templates offered in a dropdown next to New (empty → no dropdown).
  templates?: { id: number; title: string }[];
  onNewFromTemplate?: (id: number) => void;
}) {
  // resolvedTheme reflects the actual applied theme (light/dark), including when
  // the preference is "system" — reading `theme` there gives "system", making
  // the icon wrong and the first toggle a no-op.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const hasTemplates = templates.length > 0 && !!onNewFromTemplate;

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
          <div className="flex items-center">
            <button
              onClick={onNewSnippet}
              title="New prompt or snippet (Ctrl/⌘+N)"
              className={`flex items-center gap-1.5 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 ${
                hasTemplates ? "rounded-l-lg" : "rounded-lg"
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              New Prompt/Snippet
            </button>
            {hasTemplates && (
              <div className="relative">
                <button
                  onClick={() => setTplOpen((v) => !v)}
                  title="Start from a template"
                  aria-label="Start from a template"
                  aria-haspopup="true"
                  aria-expanded={tplOpen}
                  className="flex items-center rounded-r-lg border-l border-primary-foreground/20 bg-primary px-1.5 py-1.5 text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                {tplOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setTplOpen(false)}
                      aria-hidden
                    />
                    <div className="absolute right-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg">
                      <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                        Start from a template
                      </p>
                      {templates.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => {
                            setTplOpen(false);
                            onNewFromTemplate?.(t.id);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{t.title || "(untitled)"}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
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
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              title="Settings"
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
