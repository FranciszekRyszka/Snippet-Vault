"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, ChevronDown, Plus, X } from "lucide-react";
import {
  DEFAULT_LAUNCHERS,
  isValidLauncherUrl,
  loadCustomLaunchers,
  saveCustomLaunchers,
  type Launcher,
} from "@/lib/launchers";

// A "Run in…" dropdown: pick a destination (ChatGPT / Claude / … / your own) to
// copy the prompt and open that site. The parent handles the copy + open via
// onLaunch; this component only owns the target list and its editor.
export function RunInMenu({ onLaunch }: { onLaunch: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<Launcher[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Load custom targets when the menu first opens (localStorage is client-only).
  useEffect(() => {
    if (open) setCustom(loadCustomLaunchers());
  }, [open]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const persist = (list: Launcher[]) => {
    setCustom(list);
    saveCustomLaunchers(list);
  };

  const addTarget = () => {
    const trimmedName = name.trim();
    const trimmedUrl = url.trim();
    if (!trimmedName) {
      setErr("Give the target a name.");
      return;
    }
    if (!isValidLauncherUrl(trimmedUrl)) {
      setErr("Enter a valid http(s) URL.");
      return;
    }
    persist([
      ...custom,
      { id: `c-${Date.now()}`, name: trimmedName.slice(0, 40), url: trimmedUrl },
    ]);
    setName("");
    setUrl("");
    setErr(null);
    setAdding(false);
  };

  const removeTarget = (id: string) =>
    persist(custom.filter((l) => l.id !== id));

  const launch = (target: Launcher) => {
    onLaunch(target.url);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        title="Copy the prompt and open it in a chat app"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ExternalLink className="h-4 w-4" />
        Run in
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-10 mb-1 w-60 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {[...DEFAULT_LAUNCHERS, ...custom].map((target) => {
            const isCustom = custom.some((c) => c.id === target.id);
            return (
              <div
                key={target.id}
                className="group/item flex items-center justify-between px-1"
              >
                <button
                  role="menuitem"
                  onClick={() => launch(target)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{target.name}</span>
                </button>
                {isCustom && (
                  <button
                    onClick={() => removeTarget(target.id)}
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/item:opacity-100"
                    aria-label={`Remove ${target.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="my-1 border-t border-border" />

          {adding ? (
            <div className="px-2 py-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. Poe)"
                className="mb-1.5 w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                onKeyDown={(e) => e.key === "Enter" && addTarget()}
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
              <div className="mt-1.5 flex justify-end gap-1.5">
                <button
                  onClick={() => {
                    setAdding(false);
                    setErr(null);
                  }}
                  className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  onClick={addTarget}
                  className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Add target…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
