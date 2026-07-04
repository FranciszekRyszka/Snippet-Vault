"use client";

import { useEffect, useState } from "react";
import {
  X,
  Copy,
  Check,
  Download,
  Pencil,
  Trash2,
  Star,
  Cpu,
  Hash,
} from "lucide-react";
import { getLanguageLabel } from "@/lib/languages";
import { getPromptStats, formatCount } from "@/lib/prompt-stats";
import { CodeBlock } from "./code-block";
import { exportSnippet } from "./snippet-card";
import type { Snippet } from "@/lib/tauri-api";

type SnippetDetailProps = {
  snippet: Snippet;
  onClose: () => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onTagClick: (tag: string) => void;
  onModelClick: (model: string) => void;
  onCopied: (id: number) => void;
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  // Stored timestamps are UTC "YYYY-MM-DD HH:MM:SS"; make them a real Date.
  const d = new Date(value.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SnippetDetail({
  snippet,
  onClose,
  onEdit,
  onDelete,
  onToggleFavorite,
  onTagClick,
  onModelClick,
  onCopied,
}: SnippetDetailProps) {
  const [copied, setCopied] = useState(false);
  const stats = getPromptStats(snippet.code);
  const tags = snippet.tags || [];

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

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

  const meta: { label: string; value: string }[] = [
    { label: "Created", value: formatDateTime(snippet.created_at) },
    { label: "Updated", value: formatDateTime(snippet.updated_at) },
    { label: "Times copied", value: formatCount(snippet.copy_count) },
    { label: "Last copied", value: formatDateTime(snippet.last_used_at) },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-foreground">
              {snippet.title}
            </h2>
            {snippet.description && (
              <p className="mt-1 text-sm text-muted-foreground">
                {snippet.description}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => onToggleFavorite(snippet.id, !snippet.favorite)}
              className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                snippet.favorite
                  ? "text-amber-500 hover:bg-accent"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
              aria-label={snippet.favorite ? "Unpin prompt" : "Pin prompt"}
              aria-pressed={snippet.favorite}
            >
              <Star
                className={`h-4 w-4 ${snippet.favorite ? "fill-current" : ""}`}
              />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 pt-4">
          <span className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            {getLanguageLabel(snippet.language)}
          </span>
          {snippet.model && (
            <button
              onClick={() => onModelClick(snippet.model)}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/70"
              title={`Filter by ${snippet.model}`}
            >
              <Cpu className="h-3 w-3" />
              {snippet.model}
            </button>
          )}
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagClick(tag)}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Code */}
        <div className="p-5">
          <CodeBlock
            code={snippet.code}
            language={snippet.language}
            maxHeight="50vh"
            onCopied={() => onCopied(snippet.id)}
          />
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            {formatCount(stats.chars)} characters · {formatCount(stats.words)} words
            · ~{formatCount(stats.tokens)} tokens
          </p>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-4 border-t border-border px-5 py-4 sm:grid-cols-4">
          {meta.map((m) => (
            <div key={m.label}>
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="mt-0.5 text-sm text-foreground">{m.value}</dd>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border p-4">
          <button
            onClick={() => onDelete(snippet)}
            className="mr-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
          <button
            onClick={() => exportSnippet(snippet)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
          <button
            onClick={() => onEdit(snippet)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
