"use client";

import { Search, X, Tag } from "lucide-react";
import { LANGUAGES } from "@/lib/languages";

export type SearchMode = "all" | "title" | "tags";

type SearchBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  activeTag: string;
  onActiveTagChange: (tag: string) => void;
  allTags: string[];
};

export function SearchBar({
  search,
  onSearchChange,
  language,
  onLanguageChange,
  searchMode,
  onSearchModeChange,
  activeTag,
  onActiveTagChange,
  allTags,
}: SearchBarProps) {
  const placeholders: Record<SearchMode, string> = {
    all: "Search by title, description, or tags...",
    title: "Search by title or description...",
    tags: "Search by tags...",
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={placeholders[searchMode]}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <select
            value={searchMode}
            onChange={(e) => onSearchModeChange(e.target.value as SearchMode)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Fields</option>
            <option value="title">Title / Desc</option>
            <option value="tags">Tags Only</option>
          </select>

          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="h-10 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All Languages</option>
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Tag className="h-3.5 w-3.5 text-muted-foreground" />
          {activeTag && (
            <button
              onClick={() => onActiveTagChange("")}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            >
              Clear
              <X className="h-3 w-3" />
            </button>
          )}
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onActiveTagChange(activeTag === tag ? "" : tag)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                activeTag === tag
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
