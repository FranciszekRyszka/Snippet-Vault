"use client";

import { Code2, Plus } from "lucide-react";

type EmptyStateProps = {
  hasFilters: boolean;
  onNewSnippet: () => void;
};

export function EmptyState({ hasFilters, onNewSnippet }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Code2 className="h-7 w-7 text-muted-foreground" />
      </div>
      {hasFilters ? (
        <>
          <h3 className="text-lg font-semibold text-foreground">
            No prompts found
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Try adjusting your search or filter to find what you are looking for.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-lg font-semibold text-foreground">
            No prompts yet
          </h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Start building your library by adding your first prompt.
          </p>
          <button
            onClick={onNewSnippet}
            className="mt-4 flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Prompt
          </button>
        </>
      )}
    </div>
  );
}
