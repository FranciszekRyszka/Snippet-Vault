"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Header } from "./header";
import { SearchBar, type SearchMode, type ViewMode } from "./search-bar";
import { SnippetCard } from "./snippet-card";
import { SnippetForm } from "./snippet-form";
import { SnippetDetail } from "./snippet-detail";
import { EmptyState } from "./empty-state";
import { DbSetupDialog } from "./db-setup-dialog";
import { SettingsDialog } from "./settings-dialog";
import { UpdateBanner } from "./update-banner";
import {
  checkForUpdate,
  isAutoUpdateEnabled,
  type AvailableUpdate,
} from "@/lib/updater";
import { useDebounce } from "@/hooks/use-debounce";
import {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  setFavorite,
  recordCopy,
  restoreSnippet,
  getInitStatus,
  isTauri,
  type Snippet,
  type CreateSnippetInput,
} from "@/lib/tauri-api";
import { LANGUAGES } from "@/lib/languages";
import { Cpu, Loader2, X } from "lucide-react";

export function SnippetsDashboard() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Database readiness (desktop first-run setup). `null` = still checking.
  const [dbReady, setDbReady] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Set after mount to avoid hydration mismatch on the desktop-only settings UI.
  const [desktop, setDesktop] = useState(false);

  // Update found by the automatic startup check (desktop only).
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("all");
  const [activeTag, setActiveTag] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [activeModel, setActiveModel] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [showForm, setShowForm] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Undo-after-delete: the last deleted snippet, held so it can be restored.
  const [pendingUndo, setPendingUndo] = useState<Snippet | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [importNotice, setImportNotice] = useState<string | null>(null);
  const importTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transient error toast for failed writes (delete/save/undo/favorite).
  const [actionError, setActionError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Monotonic fetch counter so a slow, stale response can't overwrite a newer one.
  const fetchSeq = useRef(0);

  // Ids removed optimistically by a delete. Filtered out of any fetch result so
  // a refetch already in flight when the delete happened can't re-add the row.
  const pendingDeletes = useRef<Set<number>>(new Set());

  const debouncedSearch = useDebounce(search, 300);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showError = useCallback((message: string) => {
    setActionError(message);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setActionError(null), 5000);
  }, []);

  const showImportNotice = useCallback((message: string) => {
    setImportNotice(message);
    if (importTimer.current) clearTimeout(importTimer.current);
    importTimer.current = setTimeout(() => setImportNotice(null), 4000);
  }, []);

  // Restore the saved view preference (client-only to avoid hydration mismatch).
  useEffect(() => {
    try {
      const saved = localStorage.getItem("snipvault:view");
      if (saved === "grid" || saved === "list") setView(saved);
    } catch {
      // ignore storage failures (e.g. private mode / blocked storage)
    }
  }, []);

  const changeView = (v: ViewMode) => {
    setView(v);
    try {
      localStorage.setItem("snipvault:view", v);
    } catch {
      // ignore storage failures (e.g. private mode)
    }
  };

  // Drop any ids currently being deleted, so a fetch that was already in flight
  // when a delete happened doesn't re-add the removed row.
  const dropPendingDeletes = useCallback(
    (list: Snippet[]) =>
      pendingDeletes.current.size
        ? list.filter((s) => !pendingDeletes.current.has(s.id))
        : list,
    []
  );

  // Fetch snippets
  const fetchSnippets = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setIsLoading(true);
    setError(null);
    try {
      const params: {
        search?: string;
        language?: string;
        tag?: string;
        searchMode?: string;
      } = {};
      if (debouncedSearch) {
        params.search = debouncedSearch;
        params.searchMode = searchMode;
      }
      if (language) params.language = language;
      if (activeTag) params.tag = activeTag;

      const data = await getSnippets(params);
      // Ignore this response if a newer fetch has started since.
      if (seq !== fetchSeq.current) return;
      setSnippets(dropPendingDeletes(data));
    } catch (err) {
      if (seq !== fetchSeq.current) return;
      setError(err instanceof Error ? err : new Error("Failed to load snippets"));
    } finally {
      if (seq === fetchSeq.current) setIsLoading(false);
    }
  }, [debouncedSearch, language, activeTag, searchMode, dropPendingDeletes]);

  // Fetch all snippets for tag cloud
  const fetchAllSnippets = useCallback(async () => {
    try {
      const data = await getSnippets();
      setAllSnippets(dropPendingDeletes(data));
    } catch {
      // Silently fail for tag cloud
    }
  }, [dropPendingDeletes]);

  // On mount, check whether a database is configured (desktop first-run).
  useEffect(() => {
    setDesktop(isTauri());
    getInitStatus()
      .then((status) => setDbReady(status.initialized))
      .catch(() => setDbReady(false));
  }, []);

  // On startup, look for an app update (desktop only, and only if the user
  // hasn't disabled automatic checks in Settings). Failures are silent.
  useEffect(() => {
    if (!isTauri() || !isAutoUpdateEnabled()) return;
    checkForUpdate()
      .then((found) => {
        if (found) setUpdate(found);
      })
      .catch(() => {});
  }, []);

  // Only load snippets once the database is ready.
  useEffect(() => {
    if (dbReady) fetchSnippets();
  }, [dbReady, fetchSnippets]);

  useEffect(() => {
    if (dbReady) fetchAllSnippets();
  }, [dbReady, fetchAllSnippets]);

  // Clear any pending timers on unmount.
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (importTimer.current) clearTimeout(importTimer.current);
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  // Collect all unique tags from all snippets for the tag cloud
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const snippet of allSnippets) {
      for (const tag of snippet.tags || []) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  }, [allSnippets]);

  // Library-wide stats (based on the full, unfiltered collection).
  const stats = useMemo(() => {
    const languages = new Set<string>();
    for (const snippet of allSnippets) {
      if (snippet.language) languages.add(snippet.language);
    }
    return {
      total: allSnippets.length,
      languages: languages.size,
      tags: allTags.length,
    };
  }, [allSnippets, allTags]);

  // Client-side filters layered on top of the server-side search/language/tag.
  const visible = useMemo(() => {
    let list = snippets;
    if (favoritesOnly) list = list.filter((s) => s.favorite);
    if (activeModel) list = list.filter((s) => s.model === activeModel);
    return list;
  }, [snippets, favoritesOnly, activeModel]);

  const detailSnippet = useMemo(
    () =>
      detailId === null ? null : snippets.find((s) => s.id === detailId) ?? null,
    [detailId, snippets]
  );

  const handleSave = async (data: {
    title: string;
    description: string;
    code: string;
    language: string;
    tags: string[];
    model: string;
  }) => {
    setSaving(true);
    try {
      if (editingSnippet) {
        const updated = await updateSnippet(editingSnippet.id, data);
        // A null result means the row no longer exists (e.g. deleted elsewhere).
        if (updated === null) {
          throw new Error("This prompt no longer exists — it may have been deleted.");
        }
      } else {
        await createSnippet(data);
      }
      await fetchSnippets();
      await fetchAllSnippets();
      setShowForm(false);
      setEditingSnippet(null);
    } catch (err) {
      // Keep the form open so the user's edits aren't lost, and tell them why.
      console.error("Failed to save snippet:", err);
      showError(err instanceof Error ? err.message : "Failed to save the prompt.");
    } finally {
      setSaving(false);
    }
  };

  // Delete immediately and offer an Undo toast for a few seconds. Undo restores
  // the prompt faithfully (favorite, model, usage, timestamps) via restore.
  const handleDelete = async (snippet: Snippet) => {
    setDetailId(null);
    pendingDeletes.current.add(snippet.id);
    setSnippets((prev) => prev.filter((s) => s.id !== snippet.id));
    setAllSnippets((prev) => prev.filter((s) => s.id !== snippet.id));
    setPendingUndo(snippet);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setPendingUndo(null), 6000);
    try {
      await deleteSnippet(snippet.id);
    } catch (err) {
      // The delete failed server-side; undo the optimistic removal and hide the
      // (now-misleading) Undo toast so a later click can't create a duplicate.
      console.error("Failed to delete snippet:", err);
      pendingDeletes.current.delete(snippet.id);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setPendingUndo(null);
      showError(err instanceof Error ? err.message : "Failed to delete the prompt.");
      await fetchSnippets();
      await fetchAllSnippets();
    }
  };

  const handleUndo = async () => {
    const snip = pendingUndo;
    if (!snip) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setPendingUndo(null);
    try {
      await restoreSnippet(snip);
      await fetchSnippets();
      await fetchAllSnippets();
    } catch (err) {
      // Restore failed — re-offer Undo so the deletion isn't silently unrecoverable.
      console.error("Failed to restore snippet:", err);
      showError(err instanceof Error ? err.message : "Couldn't restore the prompt.");
      setPendingUndo(snip);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setPendingUndo(null), 6000);
    }
  };

  const handleToggleFavorite = async (id: number, favorite: boolean) => {
    // Optimistically flip the star for snappiness, then refetch so the pinned
    // ordering is applied (and rolled back if the write fails).
    setSnippets((prev) => prev.map((s) => (s.id === id ? { ...s, favorite } : s)));
    try {
      await setFavorite(id, favorite);
      await fetchSnippets();
    } catch (err) {
      console.error("Failed to update favorite:", err);
      showError(err instanceof Error ? err.message : "Failed to update the pin.");
      setSnippets((prev) =>
        prev.map((s) => (s.id === id ? { ...s, favorite: !favorite } : s))
      );
    }
  };

  // Record a copy for usage tracking, updating the count optimistically.
  const handleCopied = (id: number) => {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const bump = (s: Snippet) =>
      s.id === id
        ? { ...s, copy_count: s.copy_count + 1, last_used_at: now }
        : s;
    setSnippets((prev) => prev.map(bump));
    setAllSnippets((prev) => prev.map(bump));
    void recordCopy(id);
  };

  const handleModelClick = (model: string) =>
    setActiveModel((prev) => (prev === model ? "" : model));

  const handleImportClick = () => fileInputRef.current?.click();

  // Import prompts from a JSON file — either a single exported prompt (an object)
  // or an array of them. Each item is imported independently: a failing item is
  // skipped and tallied rather than aborting the whole import, and the list is
  // always refreshed afterward so successful items are visible.
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-selected later
    if (!file) return;
    let imported = 0;
    let skipped = 0;
    try {
      const parsed = JSON.parse(await file.text());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const validLanguages = new Set(LANGUAGES.map((l) => l.value));
      for (const item of items) {
        // Skip anything without a usable title and body. An empty-string title
        // is invalid (the backend rejects it), so require non-empty after trim.
        if (
          !item ||
          typeof item.title !== "string" ||
          !item.title.trim() ||
          typeof item.code !== "string" ||
          !item.code
        ) {
          skipped++;
          continue;
        }
        // Normalize to the same shape the web API enforces, so importing on the
        // desktop (whose backend is more permissive) can't store invalid rows.
        const input: CreateSnippetInput = {
          title: item.title.trim().slice(0, 255),
          description:
            typeof item.description === "string" ? item.description : "",
          code: item.code,
          language: validLanguages.has(item.language) ? item.language : "text",
          tags: Array.isArray(item.tags)
            ? item.tags
                .filter((t: unknown): t is string => typeof t === "string")
                .map((t: string) => t.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 20)
            : [],
          model:
            typeof item.model === "string" ? item.model.trim().slice(0, 100) : "",
        };
        try {
          await createSnippet(input);
          imported++;
        } catch (itemErr) {
          console.error("Failed to import one prompt:", itemErr);
          skipped++;
        }
      }
      showImportNotice(
        imported > 0
          ? `Imported ${imported} prompt${imported !== 1 ? "s" : ""}${
              skipped ? `, skipped ${skipped}` : ""
            }.`
          : skipped > 0
            ? `No prompts imported (${skipped} skipped).`
            : "No valid prompts found in that file."
      );
    } catch (err) {
      // Only reached if the file itself isn't valid JSON.
      console.error("Import failed:", err);
      showImportNotice("Couldn't read that file — is it a valid JSON export?");
    } finally {
      await fetchSnippets();
      await fetchAllSnippets();
    }
  };

  const handleNewSnippet = useCallback(() => {
    setEditingSnippet(null);
    setShowForm(true);
  }, []);

  // Whether any modal/dialog is currently open.
  const anyModalOpen =
    showForm || showSettings || detailId !== null || dbReady === false;

  // Global keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      // Esc closes whatever dialog is open (the detail view handles its own Esc;
      // the first-run setup must be completed so is not closable here).
      if (e.key === "Escape") {
        if (showForm) {
          setShowForm(false);
          setEditingSnippet(null);
        } else if (showSettings) {
          setShowSettings(false);
        }
        return;
      }

      // Don't fire creation/search shortcuts while a dialog is open.
      if (anyModalOpen) return;

      // Cmd/Ctrl+N — new prompt.
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNewSnippet();
        return;
      }

      // Cmd/Ctrl+K or "/" — focus the search box.
      if ((mod && e.key.toLowerCase() === "k") || (e.key === "/" && !typing)) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [anyModalOpen, showForm, showSettings, handleNewSnippet]);

  const handleEdit = (snippet: Snippet) => {
    setDetailId(null);
    setEditingSnippet(snippet);
    setShowForm(true);
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(activeTag === tag ? "" : tag);
  };

  const hasFilters =
    !!debouncedSearch ||
    !!language ||
    !!activeTag ||
    favoritesOnly ||
    !!activeModel;

  return (
    <div className="min-h-screen bg-background">
      <Header
        onNewSnippet={handleNewSnippet}
        onImport={handleImportClick}
        onOpenSettings={desktop ? () => setShowSettings(true) : undefined}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportFile}
        className="hidden"
      />

      <main className="mx-auto max-w-6xl px-4 py-6">
        {update && !updateDismissed && (
          <UpdateBanner
            update={update}
            onDismiss={() => setUpdateDismissed(true)}
          />
        )}

        {importNotice && (
          <div className="mb-4 rounded-lg border border-border bg-primary/10 px-4 py-2.5 text-sm text-primary">
            {importNotice}
          </div>
        )}

        <div className="mb-6">
          <SearchBar
            search={search}
            onSearchChange={setSearch}
            language={language}
            onLanguageChange={setLanguage}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            activeTag={activeTag}
            onActiveTagChange={setActiveTag}
            allTags={allTags}
            favoritesOnly={favoritesOnly}
            onFavoritesOnlyChange={setFavoritesOnly}
            view={view}
            onViewChange={changeView}
            inputRef={searchInputRef}
          />
        </div>

        {dbReady && stats.total > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground">{stats.total}</span>{" "}
              prompt{stats.total !== 1 ? "s" : ""}
            </span>
            <span>
              <span className="font-semibold text-foreground">
                {stats.languages}
              </span>{" "}
              language{stats.languages !== 1 ? "s" : ""}
            </span>
            <span>
              <span className="font-semibold text-foreground">{stats.tags}</span>{" "}
              tag{stats.tags !== 1 ? "s" : ""}
            </span>
          </div>
        )}

        {activeModel && (
          <div className="mb-4">
            <button
              onClick={() => setActiveModel("")}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/70"
            >
              <Cpu className="h-3 w-3" />
              {activeModel}
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-sm text-destructive">
              Failed to load prompts. Please try again.
            </p>
            <button
              type="button"
              onClick={() => fetchSnippets()}
              className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        ) : visible.length > 0 ? (
          <>
            {hasFilters && (
              <p className="mb-4 text-sm text-muted-foreground">
                {visible.length} prompt{visible.length !== 1 ? "s" : ""} found
              </p>
            )}
            <div
              className={
                view === "grid"
                  ? "grid gap-4 sm:grid-cols-1 lg:grid-cols-2"
                  : "flex flex-col gap-2"
              }
            >
              {visible.map((snippet) => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  view={view}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onTagClick={handleTagClick}
                  onModelClick={handleModelClick}
                  onToggleFavorite={handleToggleFavorite}
                  onOpen={(s) => setDetailId(s.id)}
                  onCopied={handleCopied}
                />
              ))}
            </div>
          </>
        ) : (
          <EmptyState hasFilters={hasFilters} onNewSnippet={handleNewSnippet} />
        )}
      </main>

      {showForm && (
        <SnippetForm
          snippet={editingSnippet}
          onSave={handleSave}
          onCancel={() => {
            setShowForm(false);
            setEditingSnippet(null);
          }}
          saving={saving}
          allTags={allTags}
        />
      )}

      {detailSnippet && (
        <SnippetDetail
          snippet={detailSnippet}
          onClose={() => setDetailId(null)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onToggleFavorite={handleToggleFavorite}
          onTagClick={(tag) => {
            handleTagClick(tag);
            setDetailId(null);
          }}
          onModelClick={(model) => {
            handleModelClick(model);
            setDetailId(null);
          }}
          onCopied={handleCopied}
        />
      )}

      {pendingUndo && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-lg">
          <span className="text-foreground">
            Deleted{" "}
            <span className="max-w-[16rem] truncate align-bottom font-medium">
              &ldquo;{pendingUndo.title}&rdquo;
            </span>
          </span>
          <button
            onClick={handleUndo}
            className="font-medium text-primary transition-colors hover:underline"
          >
            Undo
          </button>
        </div>
      )}

      {actionError && (
        <div className="fixed bottom-20 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive shadow-lg">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-destructive/70 transition-colors hover:text-destructive"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {dbReady === false && (
        <DbSetupDialog onComplete={() => setDbReady(true)} />
      )}

      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onDbChanged={() => {
            fetchSnippets();
            fetchAllSnippets();
          }}
        />
      )}
    </div>
  );
}
