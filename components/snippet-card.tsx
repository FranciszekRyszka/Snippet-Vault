"use client";

import { useState } from "react";
import { Pencil, Trash2, Calendar, Copy, Check, Star, Download } from "lucide-react";
import { getLanguageLabel } from "@/lib/languages";
import { CodeBlock } from "./code-block";
import type { Snippet } from "@/lib/tauri-api";

type SnippetCardProps = {
  snippet: Snippet;
  onEdit: (snippet: Snippet) => void;
  onDelete: (id: number) => void;
  onTagClick: (tag: string) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
};

export function SnippetCard({ snippet, onEdit, onDelete, onTagClick, onToggleFavorite }: SnippetCardProps) {
  const [copied, setCopied] = useState(false);

  const date = new Date(snippet.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const tags = snippet.tags || [];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(snippet.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export this single prompt as a JSON file. A Blob download works in both the
  // browser and the Tauri (WebView2) webview, so no filesystem plugin is needed.
  const handleExport = () => {
    const data = {
      title: snippet.title,
      description: snippet.description,
      code: snippet.code,
      language: snippet.language,
      tags: snippet.tags || [],
    };
    const slug =
      snippet.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "prompt";
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/30">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground">
            {snippet.title}
          </h3>
          {snippet.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {snippet.description}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* The star is always visible when pinned so favorites are marked at rest;
              otherwise it appears (empty) on hover like the other actions. */}
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
            <Star
              className={`h-3.5 w-3.5 ${snippet.favorite ? "fill-current" : ""}`}
            />
          </button>
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
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleExport}
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
            onClick={() => onDelete(snippet.id)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete prompt"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          </div>
        </div>
      </div>

      <CodeBlock code={snippet.code} language={snippet.language} maxHeight="240px" />

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {getLanguageLabel(snippet.language)}
          </span>
          {tags.slice(0, 5).map((tag) => (
            <button
              key={tag}
              onClick={() => onTagClick(tag)}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {tag}
            </button>
          ))}
          {tags.length > 5 && (
            <span className="text-xs text-muted-foreground">
              +{tags.length - 5} more
            </span>
          )}
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {date}
        </span>
      </div>
    </article>
  );
}
