"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  Copy,
  CopyPlus,
  Check,
  Download,
  Pencil,
  Trash2,
  Star,
  Cpu,
  Hash,
  Code,
  Braces,
  History,
  RotateCcw,
  Loader2,
  ChevronDown,
  FileCode2,
  FileDown,
} from "lucide-react";
import { getLanguageLabel } from "@/lib/languages";
import { getPromptStats, formatCount, showTokenEstimate } from "@/lib/prompt-stats";
import { extractVars } from "@/lib/prompt-vars";
import { CodeBlock } from "./code-block";
import { exportSnippet, exportSnippetMarkdown } from "./snippet-card";
import { FillVarsDialog } from "./fill-vars-dialog";
import { DiffBlock } from "./diff-block";
import { diffLines, diffStats } from "@/lib/diff";
import { toMarkdown } from "@/lib/to-markdown";
import { getRevisions, type Snippet, type SnippetRevision } from "@/lib/tauri-api";

type SnippetDetailProps = {
  snippet: Snippet;
  onClose: () => void;
  onEdit: (snippet: Snippet) => void;
  onDelete: (snippet: Snippet) => void;
  onToggleFavorite: (id: number, favorite: boolean) => void;
  onTagClick: (tag: string) => void;
  onModelClick: (model: string) => void;
  onCopied: (id: number) => void;
  onExported: (snippet: Snippet, filename: string | null) => void;
  // Restore the snippet to a past version (writes it back as a normal edit,
  // which itself captures the current state). Resolves once reloaded.
  onRestoreRevision: (snippet: Snippet, revision: SnippetRevision) => Promise<void>;
  onDuplicate: (snippet: Snippet) => void;
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
  onExported,
  onRestoreRevision,
  onDuplicate,
}: SnippetDetailProps) {
  const [copied, setCopied] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);
  const [showFill, setShowFill] = useState(false);
  const stats = getPromptStats(snippet.code);
  const tags = snippet.tags || [];

  // Prompt history (past versions). Loaded lazily when the panel is opened.
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<SnippetRevision[] | null>(null);
  const [revsLoading, setRevsLoading] = useState(false);
  const [revsError, setRevsError] = useState<string | null>(null);
  const [expandedRev, setExpandedRev] = useState<number | null>(null);
  const [revViewMode, setRevViewMode] = useState<"diff" | "full">("diff");
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const loadRevisions = useCallback(async () => {
    setRevsLoading(true);
    setRevsError(null);
    try {
      setRevisions(await getRevisions(snippet));
    } catch (err) {
      setRevsError(
        err instanceof Error ? err.message : "Couldn't load history."
      );
    } finally {
      setRevsLoading(false);
    }
  }, [snippet]);

  // Load (or refresh) history when the panel opens.
  useEffect(() => {
    if (showHistory) loadRevisions();
  }, [showHistory, loadRevisions]);

  const handleRestore = async (rev: SnippetRevision) => {
    setRestoringId(rev.id);
    try {
      await onRestoreRevision(snippet, rev);
      // The restore captured the prior state as a new revision — refresh.
      await loadRevisions();
    } finally {
      setRestoringId(null);
    }
  };

  // Prompt variables ({{name}}) — prompts only; code snippets keep literal braces.
  const vars = useMemo(
    () => (snippet.kind === "code" ? [] : extractVars(snippet.code)),
    [snippet.kind, snippet.code]
  );
  const hasVars = vars.length > 0;

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const flashCopied = () => {
    onCopied(snippet.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopy = async () => {
    // A prompt with variables opens the fill dialog instead of copying raw.
    if (hasVars) {
      setShowFill(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet.code);
      flashCopied();
    } catch (err) {
      // Clipboard can be blocked (permissions/insecure context). Don't show a
      // false "copied" state; just log it.
      console.error("Copy failed:", err);
    }
  };

  // Copy the snippet formatted as Markdown (code → fenced block; prompt →
  // heading + body). Doesn't count as a usage copy — it's a different action.
  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(snippet));
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 2000);
    } catch (err) {
      console.error("Copy as Markdown failed:", err);
    }
  };

  const meta: { label: string; value: string }[] = [
    { label: "Created", value: formatDateTime(snippet.created_at) },
    { label: "Updated", value: formatDateTime(snippet.updated_at) },
    { label: "Times copied", value: formatCount(snippet.copy_count) },
    { label: "Last copied", value: formatDateTime(snippet.last_used_at) },
  ];

  return (
    <>
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
          {snippet.kind === "code" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <Code className="h-3 w-3" />
              Code snippet
            </span>
          )}
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
            {showTokenEstimate(snippet.kind) && (
              <> · ~{formatCount(stats.tokens)} tokens</>
            )}
            {hasVars && (
              <>
                {" "}
                · {vars.length} variable{vars.length === 1 ? "" : "s"}
              </>
            )}
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

        {/* History (past versions) */}
        <div className="border-t border-border px-5 py-4">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary"
            aria-expanded={showHistory}
          >
            <History className="h-4 w-4" />
            History
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                showHistory ? "rotate-180" : ""
              }`}
            />
          </button>

          {showHistory && (
            <div className="mt-3">
              {revsLoading && revisions === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading history…
                </p>
              ) : revsError ? (
                <p className="text-sm text-destructive">{revsError}</p>
              ) : revisions && revisions.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {revisions.map((rev) => (
                    <li
                      key={rev.id}
                      className="rounded-lg border border-border bg-background"
                    >
                      <div className="flex items-center justify-between gap-2 p-3">
                        <button
                          onClick={() =>
                            setExpandedRev((cur) =>
                              cur === rev.id ? null : rev.id
                            )
                          }
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title="Compare this version with the current one"
                        >
                          <ChevronDown
                            className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                              expandedRev === rev.id ? "rotate-180" : ""
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                            {rev.title || "(untitled)"}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDateTime(rev.saved_at)}
                          </span>
                        </button>
                        <button
                          onClick={() => handleRestore(rev)}
                          disabled={restoringId !== null}
                          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                        >
                          {restoringId === rev.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                          Restore
                        </button>
                      </div>
                      {expandedRev === rev.id && (
                        <div className="border-t border-border p-3">
                          {(() => {
                            const { added, removed } = diffStats(
                              diffLines(rev.code, snippet.code)
                            );
                            const unchanged = added === 0 && removed === 0;
                            return (
                              <>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                                    {(["diff", "full"] as const).map((mode) => (
                                      <button
                                        key={mode}
                                        onClick={() => setRevViewMode(mode)}
                                        className={`rounded px-2 py-0.5 font-medium capitalize transition-colors ${
                                          revViewMode === mode
                                            ? "bg-primary text-primary-foreground"
                                            : "text-muted-foreground hover:text-foreground"
                                        }`}
                                      >
                                        {mode === "diff" ? "Diff" : "Full text"}
                                      </button>
                                    ))}
                                  </div>
                                  {revViewMode === "diff" && (
                                    <span className="text-xs text-muted-foreground">
                                      {unchanged ? (
                                        "No changes from the current version"
                                      ) : (
                                        <>
                                          vs current:{" "}
                                          <span className="text-emerald-600 dark:text-emerald-400">
                                            +{added}
                                          </span>{" "}
                                          <span className="text-rose-600 dark:text-rose-400">
                                            −{removed}
                                          </span>
                                        </>
                                      )}
                                    </span>
                                  )}
                                </div>
                                {revViewMode === "diff" ? (
                                  <DiffBlock
                                    oldText={rev.code}
                                    newText={snippet.code}
                                  />
                                ) : (
                                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-3 text-xs text-foreground">
                                    {rev.code}
                                  </pre>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No past versions yet. Edits you make to this prompt will show up
                  here so you can compare and roll back.
                </p>
              )}
            </div>
          )}
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
            onClick={() => onDuplicate(snippet)}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <CopyPlus className="h-4 w-4" />
            Duplicate
          </button>
          <button
            onClick={handleCopyMarkdown}
            title="Copy as Markdown"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {copiedMd ? (
              <Check className="h-4 w-4" />
            ) : (
              <FileCode2 className="h-4 w-4" />
            )}
            {copiedMd ? "Copied" : "Markdown"}
          </button>
          <button
            onClick={() => onExported(snippet, exportSnippetMarkdown(snippet))}
            title="Download as a Markdown (.md) file"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <FileDown className="h-4 w-4" />
            .md
          </button>
          <button
            onClick={() => onExported(snippet, exportSnippet(snippet))}
            title="Export as a JSON file"
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
            {copied ? "Copied" : hasVars ? "Fill & Copy" : "Copy"}
          </button>
        </div>
      </div>
    </div>

      {showFill && (
        <FillVarsDialog
          uuid={snippet.uuid}
          title={snippet.title}
          code={snippet.code}
          onClose={() => setShowFill(false)}
          onCopied={flashCopied}
        />
      )}
    </>
  );
}
