"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Plus, X, ChevronDown } from "lucide-react";
import {
  addView,
  removeView,
  loadViews,
  hasActiveFilters,
  type SavedView,
  type ViewFilters,
} from "@/lib/saved-views";

// A compact "Views" dropdown: save the current filter combo under a name and
// re-apply it in one click later. Personal and per-install (localStorage).
export function SavedViews({
  current,
  onApply,
}: {
  current: ViewFilters;
  onApply: (filters: ViewFilters) => void;
}) {
  const [views, setViews] = useState<SavedView[]>([]);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setViews(loadViews()), []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setNaming(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setNaming(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const canSave = hasActiveFilters(current);

  const save = () => {
    if (!name.trim()) return;
    setViews(addView(name, current));
    setName("");
    setNaming(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        aria-expanded={open}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Views
        {views.length > 0 && (
          <span className="text-xs text-muted-foreground">{views.length}</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
          {views.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              No saved views yet.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              {views.map((v) => (
                <div
                  key={v.id}
                  className="group flex items-center rounded-md hover:bg-accent"
                >
                  <button
                    onClick={() => {
                      onApply(v.filters);
                      setOpen(false);
                    }}
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-foreground"
                  >
                    {v.name}
                  </button>
                  <button
                    onClick={() => setViews(removeView(v.id))}
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    aria-label={`Delete view ${v.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-1 border-t border-border pt-1">
            {naming ? (
              <div className="flex items-center gap-1 p-1">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    if (e.key === "Escape") setNaming(false);
                  }}
                  placeholder="View name"
                  maxLength={60}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={save}
                  disabled={!name.trim()}
                  className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setNaming(true)}
                disabled={!canSave}
                title={
                  canSave
                    ? "Save the current filters as a view"
                    : "Set some filters first"
                }
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <Plus className="h-3.5 w-3.5" />
                Save current filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
