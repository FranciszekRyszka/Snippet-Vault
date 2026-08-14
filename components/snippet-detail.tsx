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
  ChevronRight,
  FileCode2,
  FileDown,
  Eye,
  FileText,
  Link2,
  Unlink,
  Palette,
} from "lucide-react";
import { getLanguageLabel } from "@/lib/languages";
import { PROMPT_COLORS, colorHex, colorLabel } from "@/lib/prompt-colors";
import { getPromptStats, formatCount, showTokenEstimate } from "@/lib/prompt-stats";
import { extractVars } from "@/lib/prompt-vars";
import { extractLinks, resolveLink, backlinksFor } from "@/lib/prompt-links";
import { CodeBlock } from "./code-block";
import { MarkdownView } from "./markdown-view";
import { PromptBody } from "./prompt-body";
import { RunInMenu } from "./run-in-menu";
import { exportSnippet, exportSnippetMarkdown } from "./snippet-card";
import { FillVarsDialog } from "./fill-vars-dialog";
import { DiffBlock } from "./diff-block";
import { SplitDiffBlock } from "./split-diff";
import { diffLines, diffStats } from "@/lib/diff";
import { toMarkdown } from "@/lib/to-markdown";
import {
  getRevisions,
  openExternal,
  type Snippet,
  type SnippetRevision,
} from "@/lib/tauri-api";

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
  // Set (or clear, with "") the prompt's color tag.
  onSetColor: (snippet: Snippet, color: string) => void;
  // The whole library, so [[title]] links and backlinks can be resolved.
  allSnippets: Snippet[];
  // Open another prompt in place (used by the linked-prompts chips).
  onOpenLink: (id: number) => void;
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
  onSetColor,
  allSnippets,
  onOpenLink,
}: SnippetDetailProps) {
  const [copied, setCopied] = useState(false);
  // Header color-picker popover.
  const [colorOpen, setColorOpen] = useState(false);
  const currentHex = colorHex(snippet.color);
  const [copiedMd, setCopiedMd] = useState(false);
  const [showFill, setShowFill] = useState(false);
  // Rendered-Markdown vs raw view. Prompts are often Markdown, but the raw view
  // stays the default so the Copy button and syntax highlighting are unchanged;
  // code snippets never offer a preview.
  const [preview, setPreview] = useState(false);
  const canPreview = snippet.kind !== "code";
  // "Run in…" launcher: a URL to open once the prompt has been copied. For a
  // prompt with variables we open the fill dialog first and launch after the
  // filled copy; otherwise we copy and launch immediately.
  const [pendingLaunch, setPendingLaunch] = useState<string | null>(null);
  const stats = getPromptStats(snippet.code);
  const tags = snippet.tags || [];

  // Prompt history (past versions). Loaded lazily when the panel is opened.
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<SnippetRevision[] | null>(null);
  const [revsLoading, setRevsLoading] = useState(false);
  const [revsError, setRevsError] = useState<string | null>(null);
  const [expandedRev, setExpandedRev] = useState<number | null>(null);
  const [revViewMode, setRevViewMode] = useState<"diff" | "split" | "full">(
    "diff"
  );
  // What the expanded revision is diffed against: the current version (default)
  // or another past revision. Reset to "current" whenever a different revision
  // is expanded.
  const [compareId, setCompareId] = useState<number | "current">("current");
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

  // Prompt links ([[Other title]]) — prompts only; a code snippet's [[ ]] is
  // literal syntax. Forward links resolve each target against the library;
  // backlinks are the prompts that reference this one.
  const links = useMemo(
    () =>
      snippet.kind === "code"
        ? []
        : extractLinks(snippet.code).map((title) => ({
            title,
            target: resolveLink(title, allSnippets),
          })),
    [snippet.kind, snippet.code, allSnippets]
  );
  const backlinks = useMemo(
    () => backlinksFor(snippet, allSnippets),
    [snippet, allSnippets]
  );
  const hasLinks = links.length > 0 || backlinks.length > 0;

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

  // "Run in X": copy the prompt, then open the target site to paste into. A
  // prompt with variables routes through the fill dialog first (its filled text
  // is what gets copied), and we open the site once that copy completes.
  const handleLaunch = async (url: string) => {
    if (hasVars) {
      setPendingLaunch(url);
      setShowFill(true);
      return;
    }
    try {
      await navigator.clipboard.writeText(snippet.code);
      onCopied(snippet.id);
    } catch (err) {
      console.error("Copy failed:", err);
    }
    await openExternal(url);
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
            <div className="relative">
              <button
                onClick={() => setColorOpen((v) => !v)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Set color"
                aria-haspopup="true"
                aria-expanded={colorOpen}
                title={`Color: ${colorLabel(snippet.color)}`}
              >
                {currentHex ? (
                  <span
                    className="h-4 w-4 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: currentHex }}
                  />
                ) : (
                  <Palette className="h-4 w-4" />
                )}
              </button>
              {colorOpen && (
                <>
                  {/* Click-away backdrop closes the popover. */}
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setColorOpen(false)}
                    aria-hidden
                  />
                  <div className="absolute right-0 top-full z-20 mt-1 flex w-max items-center gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-lg">
                    <button
                      onClick={() => {
                        onSetColor(snippet, "");
                        setColorOpen(false);
                      }}
                      aria-label="No color"
                      aria-pressed={!snippet.color}
                      title="No color"
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent ${
                        !snippet.color ? "border-ring ring-2 ring-ring" : "border-input"
                      }`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                    {PROMPT_COLORS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => {
                          onSetColor(snippet, c.value);
                          setColorOpen(false);
                        }}
                        aria-label={c.label}
                        aria-pressed={snippet.color === c.value}
                        title={c.label}
                        style={{ backgroundColor: c.hex }}
                        className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                          snippet.color === c.value
                            ? "ring-2 ring-ring ring-offset-2 ring-offset-popover"
                            : ""
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
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
          {snippet.template && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              title="Template — a starting point in the New menu"
            >
              <FileText className="h-3 w-3" />
              Template
            </span>
          )}
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
          {canPreview && (
            <div className="mb-2 inline-flex rounded-md border border-border p-0.5 text-xs">
              {([false, true] as const).map((mode) => (
                <button
                  key={String(mode)}
                  onClick={() => setPreview(mode)}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
                    preview === mode
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode ? (
                    <Eye className="h-3 w-3" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  {mode ? "Preview" : "Raw"}
                </button>
              ))}
            </div>
          )}
          {canPreview && preview ? (
            <div style={{ maxHeight: "50vh", overflow: "auto" }}>
              <MarkdownView source={snippet.code} />
            </div>
          ) : canPreview ? (
            // Prompts (Raw): highlight {{placeholders}} so they're obvious.
            <PromptBody
              code={snippet.code}
              maxHeight="50vh"
              onCopied={() => onCopied(snippet.id)}
            />
          ) : (
            <CodeBlock
              code={snippet.code}
              language={snippet.language}
              maxHeight="50vh"
              onCopied={() => onCopied(snippet.id)}
            />
          )}
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
                          onClick={() => {
                            setExpandedRev((cur) =>
                              cur === rev.id ? null : rev.id
                            );
                            setCompareId("current");
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title="Expand to compare this version"
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
                            // Resolve the comparison target: the current version
                            // or another revision. Diff chronologically (older →
                            // newer) so +/- always reads as forward change: the
                            // current version is newest; among revisions a higher
                            // id is newer.
                            const targetRev =
                              compareId === "current"
                                ? null
                                : revisions?.find((r) => r.id === compareId) ??
                                  null;
                            const targetIsCurrent =
                              compareId === "current" || targetRev === null;
                            const targetCode = targetIsCurrent
                              ? snippet.code
                              : targetRev!.code;
                            const targetLabel = targetIsCurrent
                              ? "current version"
                              : formatDateTime(targetRev!.saved_at);
                            const targetIsNewer =
                              targetIsCurrent || targetRev!.id > rev.id;
                            const oldText = targetIsNewer ? rev.code : targetCode;
                            const newText = targetIsNewer ? targetCode : rev.code;
                            const { added, removed } = diffStats(
                              diffLines(oldText, newText)
                            );
                            const unchanged = added === 0 && removed === 0;
                            return (
                              <>
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                  <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                                    {(["diff", "split", "full"] as const).map(
                                      (mode) => (
                                        <button
                                          key={mode}
                                          onClick={() => setRevViewMode(mode)}
                                          className={`rounded px-2 py-0.5 font-medium capitalize transition-colors ${
                                            revViewMode === mode
                                              ? "bg-primary text-primary-foreground"
                                              : "text-muted-foreground hover:text-foreground"
                                          }`}
                                        >
                                          {mode === "diff"
                                            ? "Diff"
                                            : mode === "split"
                                              ? "Split"
                                              : "Full text"}
                                        </button>
                                      )
                                    )}
                                  </div>
                                  {revViewMode !== "full" && (
                                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                                      vs
                                      <select
                                        value={String(compareId)}
                                        onChange={(e) =>
                                          setCompareId(
                                            e.target.value === "current"
                                              ? "current"
                                              : Number(e.target.value)
                                          )
                                        }
                                        className="rounded border border-border bg-background px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                                      >
                                        <option value="current">
                                          Current version
                                        </option>
                                        {revisions
                                          ?.filter((r) => r.id !== rev.id)
                                          .map((r) => (
                                            <option key={r.id} value={r.id}>
                                              {formatDateTime(r.saved_at)}
                                            </option>
                                          ))}
                                      </select>
                                    </label>
                                  )}
                                  {revViewMode !== "full" && (
                                    <span className="text-xs text-muted-foreground">
                                      {unchanged ? (
                                        `No changes from the ${targetLabel}`
                                      ) : (
                                        <>
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
                                  <DiffBlock oldText={oldText} newText={newText} />
                                ) : revViewMode === "split" ? (
                                  <SplitDiffBlock
                                    oldText={oldText}
                                    newText={newText}
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

        {/* Linked prompts ([[title]] references, both directions) */}
        {hasLinks && (
          <div className="border-t border-border px-5 py-4">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Link2 className="h-4 w-4" />
              Linked prompts
            </div>

            {links.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-muted-foreground">Links to</p>
                <div className="flex flex-wrap gap-1.5">
                  {links.map(({ title, target }) =>
                    target ? (
                      <button
                        key={title}
                        onClick={() => onOpenLink(target.id)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                        title={`Open “${target.title}”`}
                      >
                        <Link2 className="h-3 w-3" />
                        {target.title}
                        <ChevronRight className="h-3 w-3 opacity-60" />
                      </button>
                    ) : (
                      <span
                        key={title}
                        className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground"
                        title="No prompt with this title yet"
                      >
                        <Unlink className="h-3 w-3" />
                        {title} · not found
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {backlinks.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs text-muted-foreground">
                  Referenced by
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {backlinks.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onOpenLink(s.id)}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/70"
                      title={`Open “${s.title}”`}
                    >
                      {s.title}
                      <ChevronRight className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
          {canPreview && <RunInMenu onLaunch={handleLaunch} />}
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
          onClose={() => {
            setShowFill(false);
            setPendingLaunch(null); // dismissed without copying → cancel the launch
          }}
          onCopied={() => {
            flashCopied();
            if (pendingLaunch) {
              const url = pendingLaunch;
              setPendingLaunch(null);
              void openExternal(url);
            }
          }}
        />
      )}
    </>
  );
}
