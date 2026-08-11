"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Code2,
  CornerDownLeft,
  FileText,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import {
  createSnippet,
  getSnippets,
  recordCopy,
  hideQuickWindow,
  type Snippet,
  type SnippetKind,
} from "@/lib/tauri-api";
import { getLanguageLabel } from "@/lib/languages";

// The always-on-top quick-capture pop-up (a second desktop webview). Two jobs:
//   • Capture — paste/type a prompt and save it, without opening the full app.
//   • Find & copy — fuzzy-search the library and copy an entry to the clipboard.
// Summoned by the global hotkey / tray; dismissed with Esc, after a save/copy,
// or by pressing the hotkey again. See lib.rs (tray + shortcut + window) and
// components/app-root.tsx (which routes the `quick` window here).

type Mode = "capture" | "search";
type Flash = { kind: "ok" | "err"; text: string } | null;

export function QuickCapture() {
  const [mode, setMode] = useState<Mode>("capture");
  const [flash, setFlash] = useState<Flash>(null);

  // Capture state
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<SnippetKind>("prompt");
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Snippet[]>([]);
  const [active, setActive] = useState(0);
  const [copyingId, setCopyingId] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const focusActiveField = useCallback(() => {
    // Defer so the element is mounted/visible before we focus it.
    requestAnimationFrame(() => {
      if (mode === "capture") bodyRef.current?.focus();
      else searchRef.current?.focus();
    });
  }, [mode]);

  // Focus the right field on mount and whenever the mode flips.
  useEffect(() => {
    focusActiveField();
  }, [focusActiveField]);

  // Re-focus when the window is re-summoned (it's hidden, not destroyed, so the
  // webview stays alive between opens).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const un = await getCurrentWindow().onFocusChanged(({ payload }) => {
          if (payload) focusActiveField();
        });
        if (cancelled) un();
        else unlisten = un;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [focusActiveField]);

  const flashThenHide = (f: Flash, resetCapture: boolean) => {
    setFlash(f);
    window.setTimeout(() => {
      setFlash(null);
      if (resetCapture) {
        setTitle("");
        setBody("");
      }
      void hideQuickWindow();
    }, 550);
  };

  // Search as you type (debounced). Empty query lists the most recent entries.
  useEffect(() => {
    if (mode !== "search") return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const rows = await getSnippets({
          search: query.trim() || undefined,
          sort: "recent",
        });
        if (!cancelled) {
          setResults(rows.slice(0, 50));
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, mode]);

  const handleSave = async () => {
    const code = body.trim();
    if (!code || saving) return;
    setSaving(true);
    try {
      const firstLine = code.split("\n").find((l) => l.trim())?.trim() ?? "";
      const finalTitle =
        title.trim() || firstLine.slice(0, 60) || "Untitled";
      await createSnippet({
        title: finalTitle,
        code,
        language: "text",
        kind,
      });
      flashThenHide({ kind: "ok", text: "Saved to your library" }, true);
    } catch (err) {
      setFlash({
        kind: "err",
        text: err instanceof Error ? err.message : "Couldn't save",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (snippet: Snippet) => {
    if (copyingId !== null) return;
    setCopyingId(snippet.id);
    try {
      await navigator.clipboard.writeText(snippet.code);
      void recordCopy(snippet.id);
      flashThenHide({ kind: "ok", text: `Copied "${snippet.title}"` }, false);
    } catch {
      setFlash({ kind: "err", text: "Couldn't copy to the clipboard" });
    } finally {
      setCopyingId(null);
    }
  };

  // Esc always dismisses. Ctrl/Cmd-Enter saves from the capture tab.
  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void hideQuickWindow();
    } else if (
      mode === "capture" &&
      (e.metaKey || e.ctrlKey) &&
      e.key === "Enter"
    ) {
      e.preventDefault();
      void handleSave();
    }
  };

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = results[active];
      if (target) void handleCopy(target);
    }
  };

  return (
    <div
      onKeyDown={onRootKeyDown}
      className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Tabs */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <TabButton
          active={mode === "capture"}
          onClick={() => setMode("capture")}
          icon={<Plus className="h-3.5 w-3.5" />}
          label="Capture"
        />
        <TabButton
          active={mode === "search"}
          onClick={() => setMode("search")}
          icon={<Search className="h-3.5 w-3.5" />}
          label="Find & copy"
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          Esc to close
        </span>
      </div>

      {mode === "capture" ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional — first line is used if blank)"
            className="shrink-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Paste or type a prompt, then ⌘/Ctrl+Enter to save…"
            className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-border">
              <KindButton
                active={kind === "prompt"}
                onClick={() => setKind("prompt")}
                icon={<FileText className="h-3.5 w-3.5" />}
                label="Prompt"
              />
              <KindButton
                active={kind === "code"}
                onClick={() => setKind("code")}
                icon={<Code2 className="h-3.5 w-3.5" />}
                label="Code"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!body.trim() || saving}
              className="ml-auto flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Save
              <kbd className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-medium">
                ⌘/Ctrl↵
              </kbd>
            </button>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search prompts to copy…"
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {results.length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                No matching prompts.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {results.map((snippet, i) => (
                  <li key={snippet.id}>
                    <button
                      type="button"
                      onMouseMove={() => setActive(i)}
                      onClick={() => handleCopy(snippet)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                        i === active
                          ? "bg-accent text-foreground"
                          : "text-foreground hover:bg-accent/60"
                      }`}
                    >
                      {snippet.kind === "code" ? (
                        <Code2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {snippet.title}
                      </span>
                      {copyingId === snippet.id ? (
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                      ) : i === active ? (
                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {getLanguageLabel(snippet.language)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Transient status line (save/copy result). */}
      {flash && (
        <div
          className={`shrink-0 border-t px-3 py-2 text-xs ${
            flash.kind === "ok"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          }`}
        >
          {flash.text}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function KindButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
