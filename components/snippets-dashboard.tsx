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
import { TrashDialog } from "./trash-dialog";
import { InsightsDialog } from "./insights-dialog";
import { TagManagerDialog } from "./tag-manager-dialog";
import { SavedViews } from "./saved-views";
import type { ViewFilters } from "@/lib/saved-views";
import { CommandPalette } from "./command-palette";
import { BulkActionsBar } from "./bulk-actions-bar";
import { FillVarsDialog } from "./fill-vars-dialog";
import { extractVars } from "@/lib/prompt-vars";
import { libraryToMarkdown } from "@/lib/to-markdown";
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
  exportLibrary,
  importLibrary,
  getInitStatus,
  getSyncServer,
  isTauri,
  type Snippet,
  type CreateSnippetInput,
  type SnippetKind,
  type SnippetRevision,
  type SyncRecord,
} from "@/lib/tauri-api";
import { runSync, isSyncing } from "@/hooks/use-sync";
import { getAutoSyncMinutes } from "@/lib/auto-sync";
import { LANGUAGES } from "@/lib/languages";
import { ArrowDownUp, Cpu, ListChecks, Loader2, Tags, Upload, X } from "lucide-react";

// Bottom-center toast stack: newest at the bottom, capped so a burst of exports
// doesn't cover the screen. Beyond the cap the oldest toast is evicted.
type Toast = { id: number; message: string; type: "info" | "error" };
const MAX_TOASTS = 3;

// Server-side sort orders. The keys map to fixed ORDER BY fragments in both
// backends (app/api/snippets/route.ts and src-tauri/src/db.rs).
type SortKey = "recent" | "most-used" | "recently-used" | "alpha";
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "recent", label: "Newest" },
  { value: "most-used", label: "Most used" },
  { value: "recently-used", label: "Recently used" },
  { value: "alpha", label: "A–Z" },
];

export function SnippetsDashboard() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Database readiness (desktop first-run setup). `null` = still checking.
  const [dbReady, setDbReady] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  // Drag-and-drop file import: whether a file is being dragged over the window.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  // Cmd/Ctrl-K quick launcher, and the prompt whose variables the launcher (or a
  // detail copy) is currently filling before copying.
  const [showPalette, setShowPalette] = useState(false);
  const [fillTarget, setFillTarget] = useState<Snippet | null>(null);
  // Whether a sync server is configured (desktop only) — gates the header's
  // sync indicator. Kept in sync with add/remove in Settings.
  const [syncEnabled, setSyncEnabled] = useState(false);
  // Opt-in background auto-sync interval (minutes; 0 = off). Read from the local
  // preference on mount; updated live when changed in Settings.
  const [autoSyncMinutes, setAutoSyncMinutes] = useState(0);
  useEffect(() => setAutoSyncMinutes(getAutoSyncMinutes()), []);

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
  // Kind quick-filter (client-side over the loaded rows) and the server-side
  // sort order.
  const [kindFilter, setKindFilter] = useState<"all" | "prompt" | "code">("all");
  const [sort, setSort] = useState<SortKey>("recent");
  // Keyboard navigation: index of the highlighted card in `visible` (-1 = none).
  const [focusedIndex, setFocusedIndex] = useState(-1);
  // Multi-select: selection mode toggle, the chosen ids, and a busy flag while a
  // bulk operation runs.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Undo-after-delete: the last deleted snippet, held so it can be restored.
  const [pendingUndo, setPendingUndo] = useState<Snippet | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Transient toasts pinned to the bottom-center of the screen. Downloads and
  // imports push an "info" toast; failed writes push an "error" toast. They
  // stack (newest at the bottom) up to MAX_TOASTS — when another arrives the
  // oldest is evicted — so exporting several prompts in a row shows each
  // confirmation instead of one message clobbering the last.
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const toastTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Monotonic fetch counter so a slow, stale response can't overwrite a newer one.
  const fetchSeq = useRef(0);

  // Ids removed optimistically by a delete. Filtered out of any fetch result so
  // a refetch already in flight when the delete happened can't re-add the row.
  const pendingDeletes = useRef<Set<number>>(new Set());

  const debouncedSearch = useDebounce(search, 300);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards the once-per-launch startup sync so it doesn't re-run on every
  // dbReady change.
  const didStartupSync = useRef(false);

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, type: "info" | "error", ms: number) => {
      const id = ++toastSeq.current;
      setToasts((prev) => {
        const next = [...prev, { id, message, type }];
        // Cap the stack: drop the oldest (and cancel its timer) past the limit.
        while (next.length > MAX_TOASTS) {
          const dropped = next.shift()!;
          const timer = toastTimers.current.get(dropped.id);
          if (timer) {
            clearTimeout(timer);
            toastTimers.current.delete(dropped.id);
          }
        }
        return next;
      });
      toastTimers.current.set(
        id,
        setTimeout(() => dismissToast(id), ms)
      );
    },
    [dismissToast]
  );

  const showNotice = useCallback(
    (message: string) => pushToast(message, "info", 4000),
    [pushToast]
  );
  const showError = useCallback(
    (message: string) => pushToast(message, "error", 5000),
    [pushToast]
  );

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
        sort?: string;
      } = {};
      if (debouncedSearch) {
        params.search = debouncedSearch;
        params.searchMode = searchMode;
      }
      if (language) params.language = language;
      if (activeTag) params.tag = activeTag;
      if (sort !== "recent") params.sort = sort;

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
  }, [debouncedSearch, language, activeTag, searchMode, sort, dropPendingDeletes]);

  // Fetch all snippets for tag cloud
  const fetchAllSnippets = useCallback(async () => {
    try {
      const data = await getSnippets();
      setAllSnippets(dropPendingDeletes(data));
    } catch {
      // Silently fail for tag cloud
    }
  }, [dropPendingDeletes]);

  // Run a sync (updating the shared status the header indicator reads), then
  // reload the lists on success. Used by the startup sync and the header's
  // Sync-now button. Errors are swallowed here — the sync store records them for
  // the indicator, and the local library keeps working offline.
  const runSyncAndReload = useCallback(async () => {
    try {
      await runSync();
      fetchSnippets();
      fetchAllSnippets();
    } catch {
      // Offline or server error — the indicator shows the failed state.
    }
  }, [fetchSnippets, fetchAllSnippets]);

  // Decide whether the app is ready to load snippets. The app is always
  // local-first, so this is just the desktop first-run check (the browser
  // always reports ready). A configured sync server reconciles separately,
  // once the local database is ready (see the startup-sync effect below).
  const refreshReady = useCallback(async () => {
    try {
      const status = await getInitStatus();
      setDbReady(status.initialized);
    } catch {
      setDbReady(false);
    }
  }, []);

  // On mount, work out the active data source (desktop first-run / sync server).
  useEffect(() => {
    refreshReady();
  }, [refreshReady]);

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

  // On startup (desktop only), if a sync server is configured, reconcile with
  // it once the local database is ready, then reload the lists. Runs quietly:
  // if the server is unreachable the app keeps working against the local
  // library. Guarded so it happens once per launch.
  useEffect(() => {
    if (!dbReady || didStartupSync.current) return;
    didStartupSync.current = true;
    (async () => {
      const server = await getSyncServer();
      setSyncEnabled(!!server);
      if (!server) return;
      await runSyncAndReload();
    })();
  }, [dbReady, runSyncAndReload]);

  // Background auto-sync: when a server is configured and the user has chosen an
  // interval, reconcile every N minutes on top of the startup + manual syncs. A
  // tick is skipped while another sync is already in flight; failures are quiet
  // (the header indicator reflects them). Re-arms when the interval or server
  // connection changes, and clears on unmount.
  useEffect(() => {
    if (!isTauri() || !syncEnabled || autoSyncMinutes <= 0) return;
    const id = setInterval(() => {
      if (!isSyncing()) void runSyncAndReload();
    }, autoSyncMinutes * 60_000);
    return () => clearInterval(id);
  }, [syncEnabled, autoSyncMinutes, runSyncAndReload]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      for (const timer of timers.values()) clearTimeout(timer);
    };
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

  // Counts for the kind quick-filter, over the current server-filtered results
  // (i.e. what the search/language/tag query returned), so the segmented control
  // reflects what's actually reachable right now.
  const kindCounts = useMemo(() => {
    let code = 0;
    for (const s of snippets) if (s.kind === "code") code++;
    return { all: snippets.length, code, prompt: snippets.length - code };
  }, [snippets]);

  // Client-side filters layered on top of the server-side search/language/tag.
  const visible = useMemo(() => {
    let list = snippets;
    if (kindFilter !== "all") list = list.filter((s) => s.kind === kindFilter);
    if (favoritesOnly) list = list.filter((s) => s.favorite);
    if (activeModel) list = list.filter((s) => s.model === activeModel);
    return list;
  }, [snippets, kindFilter, favoritesOnly, activeModel]);

  // Refs so the once-bound keyboard handler always reads the current list/index.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(focusedIndex);
  focusedRef.current = focusedIndex;

  // Keep the keyboard highlight within range as the visible list changes.
  useEffect(() => {
    setFocusedIndex((i) => (i >= visible.length ? visible.length - 1 : i));
  }, [visible.length]);

  // Move the keyboard highlight and scroll it into view.
  const moveFocus = (delta: number) => {
    const list = visibleRef.current;
    if (list.length === 0) return;
    const cur = focusedRef.current;
    const next =
      cur < 0
        ? delta > 0
          ? 0
          : list.length - 1
        : Math.max(0, Math.min(cur + delta, list.length - 1));
    setFocusedIndex(next);
    document
      .getElementById(`snip-card-${list[next].id}`)
      ?.scrollIntoView({ block: "nearest" });
  };

  const detailSnippet = useMemo(() => {
    if (detailId === null) return null;
    // Prefer the current (filtered) list, but fall back to the full library so
    // opening an entry from Insights still works when a filter would hide it.
    return (
      snippets.find((s) => s.id === detailId) ??
      allSnippets.find((s) => s.id === detailId) ??
      null
    );
  }, [detailId, snippets, allSnippets]);

  const handleSave = async (data: {
    title: string;
    description: string;
    code: string;
    language: string;
    tags: string[];
    model: string;
    kind: SnippetKind;
    color: string;
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

  // Restore a snippet to a past version: write the revision's content back as a
  // normal update (which itself captures the current state as a new revision),
  // then reload so the detail reflects it. Errors are surfaced, not thrown, so
  // the detail's History panel can finish cleanly.
  const handleRestoreRevision = async (
    snip: Snippet,
    rev: SnippetRevision
  ) => {
    try {
      const updated = await updateSnippet(snip.id, {
        title: rev.title,
        description: rev.description,
        code: rev.code,
        language: rev.language,
        tags: rev.tags,
        model: rev.model,
        kind: rev.kind,
        // Color is metadata, not part of version history — keep the current one.
        color: snip.color || "",
      });
      if (updated === null) {
        throw new Error("This prompt no longer exists — it may have been deleted.");
      }
      await fetchSnippets();
      await fetchAllSnippets();
      showNotice("Restored an earlier version.");
    } catch (err) {
      console.error("Failed to restore revision:", err);
      showError(
        err instanceof Error ? err.message : "Couldn't restore that version."
      );
    }
  };

  // Fork a prompt into a new entry (a fresh uuid, its own history). Handy as a
  // starting point for a variant. The copy is a brand-new create, so it sorts to
  // the top and opens nothing — just confirms with a toast.
  const handleDuplicate = async (snip: Snippet) => {
    try {
      await createSnippet({
        title: `${snip.title} (copy)`.slice(0, 255),
        description: snip.description,
        code: snip.code,
        language: snip.language,
        tags: snip.tags,
        model: snip.model,
        kind: snip.kind,
        color: snip.color,
      });
      setDetailId(null);
      await fetchSnippets();
      await fetchAllSnippets();
      showNotice(`Duplicated "${snip.title}".`);
    } catch (err) {
      console.error("Failed to duplicate snippet:", err);
      showError(err instanceof Error ? err.message : "Couldn't duplicate the prompt.");
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

  // Set (or clear) a prompt's color from the detail view. Routes through the
  // normal update path with the snippet's current fields so it syncs; color
  // isn't part of version history, so this never adds a revision. Optimistic
  // with rollback on failure.
  const handleSetColor = async (snippet: Snippet, color: string) => {
    const prevColor = snippet.color || "";
    if (color === prevColor) return;
    const paint = (s: Snippet) => (s.id === snippet.id ? { ...s, color } : s);
    setSnippets((prev) => prev.map(paint));
    setAllSnippets((prev) => prev.map(paint));
    try {
      const updated = await updateSnippet(snippet.id, {
        title: snippet.title,
        description: snippet.description,
        code: snippet.code,
        language: snippet.language,
        tags: snippet.tags || [],
        model: snippet.model || "",
        kind: snippet.kind,
        color,
      });
      if (updated === null) {
        throw new Error("This prompt no longer exists — it may have been deleted.");
      }
    } catch (err) {
      console.error("Failed to set color:", err);
      showError(err instanceof Error ? err.message : "Couldn't set the color.");
      const rollback = (s: Snippet) =>
        s.id === snippet.id ? { ...s, color: prevColor } : s;
      setSnippets((prev) => prev.map(rollback));
      setAllSnippets((prev) => prev.map(rollback));
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

  // Copy an entry chosen from the command palette. A prompt with {{variables}}
  // opens the fill dialog first (same as copying from a card/detail); anything
  // else is copied straight to the clipboard.
  const handlePaletteCopy = async (snippet: Snippet) => {
    const hasVars =
      snippet.kind !== "code" && extractVars(snippet.code).length > 0;
    if (hasVars) {
      setFillTarget(snippet);
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet.code);
      handleCopied(snippet.id);
    } catch (err) {
      console.error("Copy failed:", err);
      showError("Couldn't copy — the clipboard may be blocked.");
    }
  };

  const handleModelClick = (model: string) =>
    setActiveModel((prev) => (prev === model ? "" : model));

  // ---- Multi-select bulk actions ----

  // The selected snippets as full objects, resolved from the loaded lists (the
  // filtered list first, then the full library). Ids that no longer resolve are
  // dropped.
  const selectedList = useMemo(() => {
    const byId = new Map<number, Snippet>();
    for (const s of allSnippets) byId.set(s.id, s);
    for (const s of snippets) byId.set(s.id, s);
    const out: Snippet[] = [];
    for (const id of selected) {
      const s = byId.get(id);
      if (s) out.push(s);
    }
    return out;
  }, [selected, snippets, allSnippets]);

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllVisible = () =>
    setSelected(new Set(visibleRef.current.map((s) => s.id)));
  const clearSelection = () => setSelected(new Set());
  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  // Pin/unpin every selected entry, then reload so the pinned ordering applies.
  const bulkFavorite = async (favorite: boolean) => {
    if (selectedList.length === 0) return;
    setBulkBusy(true);
    let failed = 0;
    for (const s of selectedList) {
      try {
        await setFavorite(s.id, favorite);
      } catch (err) {
        console.error("Bulk pin failed for", s.id, err);
        failed++;
      }
    }
    await fetchSnippets();
    await fetchAllSnippets();
    setBulkBusy(false);
    const verb = favorite ? "Pinned" : "Unpinned";
    showNotice(
      `${verb} ${selectedList.length - failed} prompt${
        selectedList.length - failed !== 1 ? "s" : ""
      }${failed ? `, ${failed} failed` : ""}.`
    );
  };

  // Set the kind (prompt/code) on every selected entry. Rewrites each row via the
  // normal update path (which captures a revision); entries already of that kind
  // are skipped.
  const bulkSetKind = async (kind: SnippetKind) => {
    const targets = selectedList.filter((s) => s.kind !== kind);
    if (targets.length === 0) {
      showNotice(`All selected are already ${kind === "code" ? "code" : "prompts"}.`);
      return;
    }
    setBulkBusy(true);
    let failed = 0;
    for (const s of targets) {
      try {
        await updateSnippet(s.id, {
          title: s.title,
          description: s.description,
          code: s.code,
          language: s.language,
          tags: s.tags || [],
          model: s.model || "",
          kind,
          color: s.color || "",
        });
      } catch (err) {
        console.error("Bulk set-kind failed for", s.id, err);
        failed++;
      }
    }
    await fetchSnippets();
    await fetchAllSnippets();
    setBulkBusy(false);
    showNotice(
      `Set ${targets.length - failed} to ${kind === "code" ? "code" : "prompt"}${
        failed ? `, ${failed} failed` : ""
      }.`
    );
  };

  // Add a tag to every selected entry that doesn't already have it. Tags are
  // normalized (trim + lowercase) to match the app's convention, and only
  // entries actually gaining the tag are rewritten.
  const bulkAddTag = async (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (!tag) return;
    const targets = selectedList.filter(
      (s) => !(s.tags || []).some((t) => t.toLowerCase() === tag)
    );
    if (targets.length === 0) {
      showNotice(`All selected already have “${tag}”.`);
      return;
    }
    setBulkBusy(true);
    let failed = 0;
    for (const s of targets) {
      try {
        await updateSnippet(s.id, {
          title: s.title,
          description: s.description,
          code: s.code,
          language: s.language,
          tags: [...(s.tags || []), tag],
          model: s.model || "",
          kind: s.kind,
          color: s.color || "",
        });
      } catch (err) {
        console.error("Bulk add-tag failed for", s.id, err);
        failed++;
      }
    }
    await fetchSnippets();
    await fetchAllSnippets();
    setBulkBusy(false);
    showNotice(
      `Tagged ${targets.length - failed} with “${tag}”${
        failed ? `, ${failed} failed` : ""
      }.`
    );
  };

  // Export the selected entries to a single JSON file (the per-prompt content
  // shape, so re-importing creates/updates them via the import path).
  const bulkExport = () => {
    if (selectedList.length === 0) return;
    try {
      const data = selectedList.map((s) => ({
        title: s.title,
        description: s.description,
        code: s.code,
        language: s.language,
        tags: s.tags || [],
        model: s.model || "",
        kind: s.kind || "prompt",
      }));
      const filename = `snipvault-selection-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showNotice(
        `Exported ${data.length} ${data.length === 1 ? "entry" : "entries"} to your Downloads folder (${filename}).`
      );
    } catch (err) {
      console.error("Bulk export failed:", err);
      showError("Couldn't export the selection.");
    }
  };

  // Delete every selected entry. Deletes are soft (they land in Trash), so no
  // per-item undo — the toast points at Trash for recovery.
  const bulkDelete = async () => {
    const targets = selectedList;
    if (targets.length === 0) return;
    setBulkBusy(true);
    const ids = new Set(targets.map((s) => s.id));
    for (const id of ids) pendingDeletes.current.add(id);
    setSnippets((prev) => prev.filter((s) => !ids.has(s.id)));
    setAllSnippets((prev) => prev.filter((s) => !ids.has(s.id)));
    let failed = 0;
    for (const s of targets) {
      try {
        await deleteSnippet(s.id);
      } catch (err) {
        console.error("Bulk delete failed for", s.id, err);
        pendingDeletes.current.delete(s.id);
        failed++;
      }
    }
    await fetchSnippets();
    await fetchAllSnippets();
    setBulkBusy(false);
    exitSelectMode();
    const done = targets.length - failed;
    if (done > 0) {
      showNotice(
        `Deleted ${done} prompt${done !== 1 ? "s" : ""} — restore from Trash if needed.`
      );
    }
    if (failed > 0) {
      showError(`Couldn't delete ${failed} prompt${failed !== 1 ? "s" : ""}.`);
    }
  };

  // Confirm a single-prompt export so the user knows the download happened and
  // where it landed. The Blob download goes to the browser/OS Downloads folder
  // (its absolute path isn't exposed to JS), and we surface the filename that
  // was written.
  const handleExported = useCallback(
    (snippet: Snippet, filename: string | null) => {
      const noun = snippet.kind === "code" ? "snippet" : "prompt";
      const title =
        snippet.title.length > 44
          ? snippet.title.slice(0, 43) + "…"
          : snippet.title;
      if (filename) {
        showNotice(
          `Downloaded ${noun} "${title}" to your Downloads folder (${filename}).`
        );
      } else {
        showError(`Couldn't download "${title}".`);
      }
    },
    [showNotice, showError]
  );

  const handleImportClick = () => fileInputRef.current?.click();

  // Export the whole library to a JSON file (the sync-record shape, so it can be
  // re-imported losslessly). Confirms with a toast like single-prompt export.
  const handleExportLibrary = useCallback(async () => {
    try {
      const records = await exportLibrary();
      if (records.length === 0) {
        showNotice("Nothing to export yet — your library is empty.");
        return;
      }
      const filename = `snipvault-library-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      const blob = new Blob([JSON.stringify(records, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showNotice(
        `Exported ${records.length} ${
          records.length === 1 ? "entry" : "entries"
        } to your Downloads folder (${filename}).`
      );
    } catch (err) {
      console.error("Library export failed:", err);
      showError(err instanceof Error ? err.message : "Couldn't export the library.");
    }
  }, [showNotice, showError]);

  // Export the whole library as a single Markdown document (readable/portable,
  // not re-importable — that's what the JSON export is for). Reuses the same
  // download + toast flow.
  const handleExportLibraryMarkdown = useCallback(async () => {
    try {
      const records = await exportLibrary();
      if (records.length === 0) {
        showNotice("Nothing to export yet — your library is empty.");
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const md = libraryToMarkdown(records, today);
      const filename = `snipvault-library-${today}.md`;
      const blob = new Blob([md], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showNotice(
        `Exported ${records.length} ${
          records.length === 1 ? "entry" : "entries"
        } as Markdown to your Downloads folder (${filename}).`
      );
    } catch (err) {
      console.error("Markdown library export failed:", err);
      showError(
        err instanceof Error ? err.message : "Couldn't export the library."
      );
    }
  }, [showNotice, showError]);

  // Whether a parsed file is a whole-library export: an array of sync records,
  // each carrying a uuid and a timestamp. Those merge by uuid (newest wins) via
  // the sync path, so re-importing updates in place instead of duplicating.
  const isLibraryExport = (parsed: unknown): parsed is SyncRecord[] =>
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (r) =>
        r &&
        typeof r === "object" &&
        typeof (r as Record<string, unknown>).uuid === "string" &&
        typeof (r as Record<string, unknown>).updated_at === "string"
    );

  // Filename without its directory or extension — used as a title for plain-text
  // imports.
  const baseName = (name: string) =>
    name
      .replace(/^.*[/\\]/, "")
      .replace(/\.[^.]+$/, "")
      .trim();

  // Import a single file. JSON is treated as an export — a whole-library file
  // merges by uuid (dedupes on re-import); otherwise it's one or more content
  // prompts, each imported independently. Any other file (.md / .txt / …) is
  // imported as a single prompt with the file's text as its body. Returns
  // tallies so a batch can show one combined summary. Throws only when a .json
  // file is malformed.
  const importOneFile = async (
    file: File
  ): Promise<{ imported: number; skipped: number; libraryApplied: number }> => {
    const text = await file.text();
    const looksJson = /\.json$/i.test(file.name) || /^\s*[[{]/.test(text);

    if (looksJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (/\.json$/i.test(file.name)) {
          throw new Error(`"${file.name}" isn't valid JSON.`);
        }
        parsed = undefined; // not really JSON — fall through to plain text
      }

      if (parsed !== undefined) {
        // Library file: merge by uuid via the sync path.
        if (isLibraryExport(parsed)) {
          const applied = await importLibrary(parsed);
          return { imported: 0, skipped: 0, libraryApplied: applied };
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const validLanguages = new Set(LANGUAGES.map((l) => l.value));
        let imported = 0;
        let skipped = 0;
        for (const item of items) {
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
          // Normalize to the shape the web API enforces, so importing on the
          // (more permissive) desktop backend can't store invalid rows.
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
              typeof item.model === "string"
                ? item.model.trim().slice(0, 100)
                : "",
            kind: item.kind === "code" ? "code" : "prompt",
          };
          try {
            await createSnippet(input);
            imported++;
          } catch (itemErr) {
            console.error("Failed to import one prompt:", itemErr);
            skipped++;
          }
        }
        return { imported, skipped, libraryApplied: 0 };
      }
    }

    // Plain text (.md / .txt / …): a single prompt with the file's text as body.
    if (!text.trim()) return { imported: 0, skipped: 1, libraryApplied: 0 };
    await createSnippet({
      title: (baseName(file.name) || "Imported prompt").slice(0, 255),
      description: "",
      code: text,
      language: /\.(md|markdown)$/i.test(file.name) ? "markdown" : "text",
      tags: [],
      model: "",
      kind: "prompt",
    });
    return { imported: 1, skipped: 0, libraryApplied: 0 };
  };

  // Import a batch of files (from the picker or a drop): process each, refresh
  // once, and show a single combined summary.
  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    let imported = 0;
    let skipped = 0;
    let libraryApplied = 0;
    let failedFiles = 0;
    for (const file of files) {
      try {
        const r = await importOneFile(file);
        imported += r.imported;
        skipped += r.skipped;
        libraryApplied += r.libraryApplied;
      } catch (err) {
        console.error(`Import of ${file.name} failed:`, err);
        failedFiles++;
      }
    }
    await fetchSnippets();
    await fetchAllSnippets();

    const parts: string[] = [];
    if (libraryApplied)
      parts.push(
        `${libraryApplied} ${libraryApplied === 1 ? "entry" : "entries"} from a library file`
      );
    if (imported) parts.push(`${imported} prompt${imported !== 1 ? "s" : ""}`);
    if (parts.length) {
      showNotice(
        `Imported ${parts.join(" and ")}${skipped ? `, skipped ${skipped}` : ""}.`
      );
    } else if (failedFiles) {
      showError(
        failedFiles === 1
          ? "Couldn't import that file."
          : `Couldn't import ${failedFiles} files.`
      );
    } else {
      showNotice(
        skipped
          ? `No prompts imported (${skipped} skipped).`
          : "No valid prompts found."
      );
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ""; // let the same file be re-selected later
    await handleFiles(files);
  };

  const handleNewSnippet = useCallback(() => {
    setEditingSnippet(null);
    setShowForm(true);
  }, []);

  // Whether any modal/dialog is currently open.
  const anyModalOpen =
    showForm ||
    showSettings ||
    showTrash ||
    showInsights ||
    showTagManager ||
    showPalette ||
    fillTarget !== null ||
    detailId !== null ||
    dbReady === false;

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
        } else if (selectMode) {
          exitSelectMode();
        }
        return;
      }

      // Cmd/Ctrl+K toggles the command palette. Handled before the modal guard
      // so it also closes the palette itself.
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
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

      // "/" — focus the search box.
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Keyboard navigation over the grid/list (only when not typing).
      if (typing) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        moveFocus(1);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === "Enter") {
        const list = visibleRef.current;
        const cur = focusedRef.current;
        if (cur >= 0 && cur < list.length) {
          e.preventDefault();
          setDetailId(list[cur].id);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [anyModalOpen, showForm, showSettings, selectMode, handleNewSnippet]);

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

  // The current filter combo, for saving/applying "views" (saved searches).
  const currentFilters: ViewFilters = {
    search,
    searchMode,
    language,
    activeTag,
    favoritesOnly,
    activeModel,
    kind: kindFilter,
    sort,
  };

  const applyView = (f: ViewFilters) => {
    setSearch(f.search);
    setSearchMode(f.searchMode as SearchMode);
    setLanguage(f.language);
    setActiveTag(f.activeTag);
    setFavoritesOnly(f.favoritesOnly);
    setActiveModel(f.activeModel);
    setKindFilter(f.kind);
    setSort(f.sort as SortKey);
  };

  // Drag-and-drop import. A depth counter keeps the overlay stable across
  // dragenter/leave on child elements (they'd otherwise flicker it). Only reacts
  // when actual files are being dragged.
  const isFileDrag = (e: React.DragEvent) =>
    Array.from(e.dataTransfer.types || []).includes("Files");

  const onDragEnter = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (isFileDrag(e)) e.preventDefault();
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
  };

  return (
    <div
      className="min-h-screen bg-background"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary bg-card px-10 py-8 text-center shadow-lg">
            <Upload className="h-8 w-8 text-primary" />
            <p className="text-base font-semibold text-foreground">
              Drop to import
            </p>
            <p className="text-xs text-muted-foreground">
              JSON exports merge by id · .md / .txt become new prompts
            </p>
          </div>
        </div>
      )}
      <Header
        onNewSnippet={handleNewSnippet}
        onOpenInsights={() => setShowInsights(true)}
        onOpenSettings={() => setShowSettings(true)}
        syncEnabled={syncEnabled}
        onSyncNow={runSyncAndReload}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
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

        {dbReady && stats.total > 0 && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* Kind quick-filter: All / Prompts / Code, with live counts. */}
            <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-sm">
              {(
                [
                  { key: "all", label: "All", count: kindCounts.all },
                  { key: "prompt", label: "Prompts", count: kindCounts.prompt },
                  { key: "code", label: "Code", count: kindCounts.code },
                ] as const
              ).map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => setKindFilter(key)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    kindFilter === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  <span
                    className={`ml-1.5 text-xs ${
                      kindFilter === key
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground/70"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {/* Multi-select toggle. */}
              <button
                onClick={() =>
                  selectMode ? exitSelectMode() : setSelectMode(true)
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm font-medium transition-colors ${
                  selectMode
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent"
                }`}
                title="Select multiple entries for bulk actions"
                aria-pressed={selectMode}
              >
                <ListChecks className="h-3.5 w-3.5" />
                Select
              </button>

              {/* Global tag manager. */}
              <button
                onClick={() => setShowTagManager(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                title="Rename, merge, or delete tags across the whole library"
              >
                <Tags className="h-3.5 w-3.5" />
                Tags
              </button>

              {/* Saved searches ("views"). */}
              <SavedViews current={currentFilters} onApply={applyView} />

              {/* Sort order (server-side). */}
              <label className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <ArrowDownUp className="h-3.5 w-3.5" />
                <span className="sr-only">Sort by</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortKey)}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
              {visible.map((snippet, i) => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  view={view}
                  focused={i === focusedIndex}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  onTagClick={handleTagClick}
                  onModelClick={handleModelClick}
                  onToggleFavorite={handleToggleFavorite}
                  onOpen={(s) => setDetailId(s.id)}
                  onCopied={handleCopied}
                  onExported={handleExported}
                  onDuplicate={handleDuplicate}
                  selectable={selectMode}
                  selected={selected.has(snippet.id)}
                  onToggleSelect={toggleSelect}
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
          // Remount on navigation between linked prompts so per-snippet panel
          // state (history, preview) doesn't carry over.
          key={detailSnippet.id}
          snippet={detailSnippet}
          allSnippets={allSnippets}
          onOpenLink={(id) => setDetailId(id)}
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
          onExported={handleExported}
          onRestoreRevision={handleRestoreRevision}
          onDuplicate={handleDuplicate}
          onSetColor={handleSetColor}
        />
      )}

      {selectMode && (
        <BulkActionsBar
          count={selected.size}
          allSelected={visible.length > 0 && selected.size >= visible.length}
          busy={bulkBusy}
          onSelectAll={selectAllVisible}
          onClear={clearSelection}
          onClose={exitSelectMode}
          onFavorite={bulkFavorite}
          onSetKind={bulkSetKind}
          onAddTag={bulkAddTag}
          onExport={bulkExport}
          onDelete={bulkDelete}
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

      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`pointer-events-auto flex max-w-[90vw] items-center gap-3 rounded-2xl px-5 py-2.5 text-sm font-medium text-white shadow-lg ${
                t.type === "error" ? "bg-rose-600" : "bg-emerald-600"
              }`}
            >
              <span className="min-w-0 break-words">{t.message}</span>
              <button
                onClick={() => dismissToast(t.id)}
                className="shrink-0 text-white/70 transition-colors hover:text-white"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <CommandPalette
        open={showPalette}
        onOpenChange={setShowPalette}
        snippets={allSnippets}
        onCopy={handlePaletteCopy}
      />

      {fillTarget && (
        <FillVarsDialog
          uuid={fillTarget.uuid}
          title={fillTarget.title}
          code={fillTarget.code}
          onClose={() => setFillTarget(null)}
          onCopied={() => handleCopied(fillTarget.id)}
        />
      )}

      {showTrash && (
        <TrashDialog
          onClose={() => setShowTrash(false)}
          onRestored={() => {
            fetchSnippets();
            fetchAllSnippets();
          }}
        />
      )}

      {showInsights && (
        <InsightsDialog
          snippets={allSnippets}
          onClose={() => setShowInsights(false)}
          onOpen={(s) => setDetailId(s.id)}
        />
      )}

      {showTagManager && (
        <TagManagerDialog
          snippets={allSnippets}
          onClose={() => setShowTagManager(false)}
          onChanged={() => {
            fetchSnippets();
            fetchAllSnippets();
          }}
        />
      )}

      {dbReady === false && (
        <DbSetupDialog onComplete={() => setDbReady(true)} />
      )}

      {showSettings && (
        <SettingsDialog
          onClose={() => setShowSettings(false)}
          onImport={() => {
            setShowSettings(false);
            handleImportClick();
          }}
          onExportLibrary={() => {
            setShowSettings(false);
            handleExportLibrary();
          }}
          onExportLibraryMarkdown={() => {
            setShowSettings(false);
            handleExportLibraryMarkdown();
          }}
          onAutoSyncChange={setAutoSyncMinutes}
          onOpenTrash={() => {
            setShowSettings(false);
            setShowTrash(true);
          }}
          onDbChanged={() => {
            // Covers switching local DB file and connecting/disconnecting a
            // sync server: re-evaluate the data source and whether a server is
            // configured (so the header indicator appears/disappears), then
            // reload.
            refreshReady();
            getSyncServer().then((s) => setSyncEnabled(!!s));
            fetchSnippets();
            fetchAllSnippets();
          }}
        />
      )}
    </div>
  );
}
