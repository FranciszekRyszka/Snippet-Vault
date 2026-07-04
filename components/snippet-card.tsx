"use client";

import { useState } from "react";
import {
  Pencil,
  Trash2,
  Calendar,
  Copy,
  Check,
  Star,
  Download,
  Cpu,
} from "lucide-react";
import { getLanguageLabel } from "@/lib/languages";
import { getPromptStats, formatCount } from "@/lib/prompt-stats";
import { CodeBlock } from "./code-block";
import type { Snippet } from "@/lib/tauri-api";

type SnippetCardProps = {
  snippet: Snippet;
  view: "grid" | "list";
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
  onTagClick: (tag: string) => void;
  onModelClick: (model: string) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onOpen: (snippet: Snippet) => void;
  onCopied: (id: number) => void;
};

// Build a filename-safe slug from a title for exports.
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "prompt"
  );
}

// Export a single prompt as a JSON file. A Blob download works in both the
// browser and the Tauri (WebView2) webview, so no filesystem plugin is needed.
export function exportSnippet(snippet: Snippet) {
  const data = {
    title: snippet.title,
    description: snippet.description,
    code: snippet.code,
    language: snippet.language,
    tags: snippet.tags || [],
    model: snippet.model || "",
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(snippet.title)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function SnippetCard({
  snippet,
  view,
  onEdit,
  onDelete,
  onTagClick,
  onModelClick,
  onToggleFavorite,
  onOpen,
  onCopied,
}: SnippetCardProps) {
  const [copied, setCopied] = useState(false);

  const date = new Date(snippet.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const tags = snippet.tags || [];
  const stats = getPromptStats(snippet.code);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet.code);
      onCopied(snippet.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Clipboard can be blocked (permissions/insecure context). Don't show a
      // false "copied" state; just log it.
      console.error("Copy failed:", err);
    }
  };

  const starButton = (
    <button
      onClick={() => onToggleFavorite(snippet.id, !snippet.favorite)}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
        snippet.favorite
          ? "text-amber-500 hover:bg-accent"
          : "text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
      }`}
      aria-label={snippet.favorite ? "Unpin prompt" : "Pin prompt"}
      aria-pressed={snippet.favorite}
    >
      <Star className={`h-3.5 w-3.5 ${snippet.favorite ? "fill-current" : ""}`} />
    </button>
  );

  const actionButtons = (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button
        onClick={handleCopy}
        className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
          copied
            ? "text-green-600 dark:text-green-500"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
        aria-label={copied ? "Copied" : "Copy prompt"}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={() => exportSnippet(snippet)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Export prompt"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onEdit(snippet)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Edit prompt"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onDelete(snippet)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label="Delete prompt"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const modelBadge = snippet.model ? (
    <button
      onClick={() => onModelClick(snippet.model)}
      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/70"
      title={`Filter by ${snippet.model}`}
    >
      <Cpu className="h-3 w-3" />
      {snippet.model}
    </button>
  ) : null;

  const tagChips = tags.slice(0, 5).map((tag) => (
    <button
      key={tag}
      onClick={() => onTagClick(tag)}
      className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {tag}
    </button>
  ));

  // Compact stats line: token estimate and (if used) copy count.
  const usageMeta = (
    <>
      <span title={`${formatCount(stats.chars)} characters`}>
        ~{formatCount(stats.tokens)} tok
      </span>
      {snippet.copy_count > 0 && (
        <span title="Times copied">· copied {formatCount(snippet.copy_count)}×</span>
      )}
    </>
  );

  // ---- List view: a compact row, no code preview; click to open. ----
  if (view === "list") {
    return (
      <article className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-ring/30">
        {starButton}
        <button
          onClick={() => onOpen(snippet)}
          className="min-w-0 flex-1 text-left"
        >
          <h3 className="truncate text-sm font-semibold text-foreground">
            {snippet.title}
          </h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {getLanguageLabel(snippet.language)}
            </span>
            {snippet.model && (
              <span className="inline-flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                {snippet.model}
              </span>
            )}
            {tags.length > 0 && <span className="truncate">{tags.join(", ")}</span>}
          </div>
        </button>
        <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
          {usageMeta}
        </div>
        {actionButtons}
      </article>
    );
  }

  // ---- Grid view (default): full card with code preview. ----
  return (
    <article className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/30">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            onClick={() => onOpen(snippet)}
            className="block max-w-full truncate text-left text-base font-semibold text-foreground hover:underline"
          >
            {snippet.title}
          </button>
          {snippet.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {snippet.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {starButton}
          {actionButtons}
        </div>
      </div>

      <CodeBlock
        code={snippet.code}
        language={snippet.language}
        maxHeight="240px"
        onCopied={() => onCopied(snippet.id)}
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {getLanguageLabel(snippet.language)}
          </span>
          {modelBadge}
          {tagChips}
          {tags.length > 5 && (
            <span className="text-xs text-muted-foreground">
              +{tags.length - 5} more
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden items-center gap-2 sm:flex">{usageMeta}</span>
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {date}
          </span>
        </div>
      </div>
    </article>
  );
}
