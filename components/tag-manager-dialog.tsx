"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Tags, Pencil, Trash2, Check, Loader2 } from "lucide-react";
import { rewriteTag, type Snippet } from "@/lib/tauri-api";

type TagManagerDialogProps = {
  // The full (non-deleted) library, used to list tags with their usage counts.
  snippets: Snippet[];
  onClose: () => void;
  // Called after any change so the parent can reload; the refreshed `snippets`
  // prop then re-derives this list.
  onChanged: () => void;
};

// Rename, merge, or delete a tag across the whole library. Renaming a tag to a
// name another tag already uses merges the two (the backend dedupes) — so there's
// no separate "merge" control; that's what the hint explains.
export function TagManagerDialog({
  snippets,
  onClose,
  onChanged,
}: TagManagerDialogProps) {
  const [busyTag, setBusyTag] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of snippets) {
      for (const t of s.tags || []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [snippets]);

  const run = async (from: string, to: string | null) => {
    setBusyTag(from);
    setError(null);
    try {
      await rewriteTag(from, to);
      onChanged();
      setEditing(null);
      setConfirmDelete(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't update the tag.");
    } finally {
      setBusyTag(null);
    }
  };

  const saveRename = (from: string) => {
    const to = editValue.trim().toLowerCase();
    if (!to || to === from) {
      setEditing(null);
      return;
    }
    void run(from, to);
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
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Tags className="h-5 w-5" />
            Manage tags
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="px-5 pt-3 text-xs text-muted-foreground">
          Rename, merge, or delete a tag everywhere it&apos;s used. Renaming a tag
          to a name another tag already has <strong>merges</strong> them. Changes
          sync like any edit.
        </p>

        {error && (
          <p className="mx-5 mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="max-h-[60vh] overflow-y-auto p-5">
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tags yet. Add tags to your prompts and they&apos;ll show up here.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tags.map(([tag, count]) => {
                const busy = busyTag === tag;
                return (
                  <li
                    key={tag}
                    className="rounded-lg border border-border bg-background px-3 py-2"
                  >
                    {editing === tag ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveRename(tag);
                            if (e.key === "Escape") setEditing(null);
                          }}
                          className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          placeholder="New tag name"
                        />
                        <button
                          onClick={() => saveRename(tag)}
                          disabled={busy}
                          className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        >
                          {busy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          Save
                        </button>
                        <button
                          onClick={() => setEditing(null)}
                          disabled={busy}
                          className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : confirmDelete === tag ? (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">
                          Delete <span className="font-medium">{tag}</span> from{" "}
                          {count} {count === 1 ? "entry" : "entries"}?
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            onClick={() => void run(tag, null)}
                            disabled={busy}
                            className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Delete
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            disabled={busy}
                            className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {tag}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {count}
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => {
                              setEditing(tag);
                              setEditValue(tag);
                            }}
                            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Rename
                          </button>
                          <button
                            onClick={() => setConfirmDelete(tag)}
                            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
