"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Header } from "./header";
import { SearchBar, type SearchMode } from "./search-bar";
import { SnippetCard } from "./snippet-card";
import { SnippetForm } from "./snippet-form";
import { EmptyState } from "./empty-state";
import { DeleteDialog } from "./delete-dialog";
import { useDebounce } from "@/hooks/use-debounce";
import {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  type Snippet,
} from "@/lib/tauri-api";
import { Loader2 } from "lucide-react";

export function SnippetsDashboard() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [allSnippets, setAllSnippets] = useState<Snippet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("all");
  const [activeTag, setActiveTag] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingSnippet, setEditingSnippet] = useState<Snippet | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Fetch snippets
  const fetchSnippets = useCallback(async () => {
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
      setSnippets(data);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load snippets"));
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, language, activeTag, searchMode]);

  // Fetch all snippets for tag cloud
  const fetchAllSnippets = useCallback(async () => {
    try {
      const data = await getSnippets();
      setAllSnippets(data);
    } catch {
      // Silently fail for tag cloud
    }
  }, []);

  useEffect(() => {
    fetchSnippets();
  }, [fetchSnippets]);

  useEffect(() => {
    fetchAllSnippets();
  }, [fetchAllSnippets]);

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

  const handleSave = async (data: {
    title: string;
    description: string;
    code: string;
    language: string;
    tags: string[];
  }) => {
    setSaving(true);
    try {
      if (editingSnippet) {
        await updateSnippet(editingSnippet.id, data);
      } else {
        await createSnippet(data);
      }
      await fetchSnippets();
      await fetchAllSnippets();
      setShowForm(false);
      setEditingSnippet(null);
    } catch (err) {
      console.error("Failed to save snippet:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deletingId === null) return;
    setDeleting(true);
    try {
      await deleteSnippet(deletingId);
      await fetchSnippets();
      await fetchAllSnippets();
      setDeletingId(null);
    } catch (err) {
      console.error("Failed to delete snippet:", err);
    } finally {
      setDeleting(false);
    }
  };

  const handleNewSnippet = () => {
    setEditingSnippet(null);
    setShowForm(true);
  };

  const handleEdit = (snippet: Snippet) => {
    setEditingSnippet(snippet);
    setShowForm(true);
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(activeTag === tag ? "" : tag);
  };

  const hasFilters = !!debouncedSearch || !!language || !!activeTag;

  return (
    <div className="min-h-screen bg-background">
      <Header onNewSnippet={handleNewSnippet} />

      <main className="mx-auto max-w-6xl px-4 py-6">
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
          />
        </div>

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
        ) : snippets && snippets.length > 0 ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              {snippets.length} prompt{snippets.length !== 1 ? "s" : ""}
              {hasFilters ? " found" : ""}
            </p>
            <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
              {snippets.map((snippet) => (
                <SnippetCard
                  key={snippet.id}
                  snippet={snippet}
                  onEdit={handleEdit}
                  onDelete={setDeletingId}
                  onTagClick={handleTagClick}
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

      {deletingId !== null && (
        <DeleteDialog
          onConfirm={handleDelete}
          onCancel={() => setDeletingId(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
