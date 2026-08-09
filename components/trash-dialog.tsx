"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Trash2, RotateCcw, Loader2 } from "lucide-react";
import {
  getDeletedSnippets,
  restoreSnippet,
  type Snippet,
} from "@/lib/tauri-api";
import { getLanguageLabel } from "@/lib/languages";

// Relative "deleted 3h ago" from a stored UTC timestamp ("YYYY-MM-DD HH:MM:SS").
function deletedAgo(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return "recently";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The Trash view: soft-deleted entries the app keeps (as tombstones) so they can
// be restored. Restore reuses restoreSnippet, which clears the tombstone in
// place by uuid, so it syncs as an ordinary update — no duplicate on other
// machines.
export function TrashDialog({
  onClose,
  onRestored,
}: {
  onClose: () => void;
  // Called after a successful restore so the dashboard reloads its lists.
  onRestored: () => void;
}) {
  const [items, setItems] = useState<Snippet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await getDeletedSnippets());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleRestore = async (snippet: Snippet) => {
    setRestoringId(snippet.id);
    setError(null);
    try {
      await restoreSnippet(snippet);
      setItems((prev) => (prev ? prev.filter((s) => s.id !== snippet.id) : prev));
      onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't restore that entry.");
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Trash2 className="h-4 w-4" />
            Trash
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {error && (
            <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          {items === null ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Trash is empty. Deleted prompts appear here so you can restore them.
            </p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {items.map((snippet) => (
                <li
                  key={snippet.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {snippet.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {getLanguageLabel(snippet.language)} · deleted{" "}
                      {deletedAgo(snippet.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRestore(snippet)}
                    disabled={restoringId === snippet.id}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {restoringId === snippet.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
