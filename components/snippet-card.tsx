"use client";

import { useMemo, useState } from "react";
import {
  Pencil,
  Trash2,
  Calendar,
  Copy,
  CopyPlus,
  Check,
  Star,
  Download,
  Cpu,
  Code,
  Braces,
  FileText,
} from "lucide-react";
import { getLanguageLabel } from "@/lib/languages";
import { getPromptStats, formatCount, showTokenEstimate } from "@/lib/prompt-stats";
import { extractVars } from "@/lib/prompt-vars";
import { CodeBlock } from "./code-block";
import { FillVarsDialog } from "./fill-vars-dialog";
import { toMarkdown } from "@/lib/to-markdown";
import { colorHex } from "@/lib/prompt-colors";
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "./ui/hover-card";
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
  onExported: (snippet: Snippet, filename: string | null) => void;
  onDuplicate: (snippet: Snippet) => void;
  // Highlighted by keyboard navigation (j/k) — draws a focus ring.
  focused?: boolean;
  // Multi-select mode: show a checkbox and reflect selection.
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number) => void;
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
// Returns the download filename on success (so callers can confirm *what* was
// saved and where), or null on failure.
export function exportSnippet(snippet: Snippet): string | null {
  try {
    const data = {
      title: snippet.title,
      description: snippet.description,
      code: snippet.code,
      language: snippet.language,
      tags: snippet.tags || [],
      model: snippet.model || "",
      kind: snippet.kind || "prompt",
      color: snippet.color || "",
      template: snippet.template || false,
      collection: snippet.collection || "",
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const filename = `${slugify(snippet.title)}.json`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  } catch (err) {
    console.error("Export failed:", err);
    return null;
  }
}

// Export a single prompt as a Markdown (.md) file. Like exportSnippet, works in
// both the browser and the Tauri webview via a Blob download. Returns the
// download filename on success, or null on failure.
export function exportSnippetMarkdown(snippet: Snippet): string | null {
  try {
    const blob = new Blob([toMarkdown(snippet)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const filename = `${slugify(snippet.title)}.md`;
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
  } catch (err) {
    console.error("Markdown export failed:", err);
    return null;
  }
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
  onExported,
  onDuplicate,
  focused = false,
  selectable = false,
  selected = false,
  onToggleSelect,
}: SnippetCardProps) {
  // Draw a focus ring + anchor id when keyboard-navigation highlights this card.
  const domId = `snip-card-${snippet.id}`;
  // A per-prompt color shows as a thicker colored left border on the card (inline
  // style so there's no dynamic-Tailwind-class concern); uncolored cards are
  // unchanged. Applied to both the grid and list article below.
  const accent = colorHex(snippet.color);
  const accentStyle = accent
    ? { borderLeftColor: accent, borderLeftWidth: "4px" }
    : undefined;
  const focusRing = focused ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "";
  // In selection mode, a selected card gets a tinted border/ring instead.
  const selectRing = selected ? "border-primary ring-1 ring-primary" : "";

  const selectBox = selectable ? (
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggleSelect?.(snippet.id)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
      aria-label={selected ? "Deselect prompt" : "Select prompt"}
    />
  ) : null;
  const [copied, setCopied] = useState(false);
  const [showFill, setShowFill] = useState(false);

  const date = new Date(snippet.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const tags = snippet.tags || [];
  const stats = getPromptStats(snippet.code);

  // A short peek at the body for the list-view hover preview.
  const codePreview = useMemo(() => {
    const lines = snippet.code.split("\n").slice(0, 14);
    const text = lines.join("\n");
    return snippet.code.length > text.length ? `${text}\n…` : text;
  }, [snippet.code]);

  // Prompt variables ({{name}}) — prompts only; code snippets keep literal braces.
  const vars = useMemo(
    () => (snippet.kind === "code" ? [] : extractVars(snippet.code)),
    [snippet.kind, snippet.code]
  );
  const hasVars = vars.length > 0;

  // Flash the "copied" checkmark after a successful (raw or filled) copy.
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
        aria-label={copied ? "Copied" : hasVars ? "Fill variables and copy" : "Copy prompt"}
        title={hasVars ? "Fill variables & copy" : "Copy prompt"}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={() => onDuplicate(snippet)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Duplicate prompt"
        title="Duplicate as a new prompt"
      >
        <CopyPlus className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onExported(snippet, exportSnippet(snippet))}
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

  // Compact stats line: token estimate (prompts only) and (if used) copy count.
  const usageMeta = (
    <>
      {showTokenEstimate(snippet.kind) && (
        <span title={`${formatCount(stats.chars)} characters`}>
          ~{formatCount(stats.tokens)} tok
        </span>
      )}
      {snippet.copy_count > 0 && (
        <span title="Times copied">
          {showTokenEstimate(snippet.kind) ? "· " : ""}copied{" "}
          {formatCount(snippet.copy_count)}×
        </span>
      )}
    </>
  );

  // Small badge marking a code snippet (prompts are the implicit default, so
  // they get no badge — keeps the common case uncluttered).
  const kindBadge =
    snippet.kind === "code" ? (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
        title="Code snippet"
      >
        <Code className="h-3 w-3" />
        Code
      </span>
    ) : null;

  // Badge marking a reusable template (a starting point in the New menu).
  const templateBadge = snippet.template ? (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
      title="Template — a starting point in the New menu"
    >
      <FileText className="h-3 w-3" />
      Template
    </span>
  ) : null;

  // Badge marking a prompt with fillable variables, so it's discoverable that
  // copying opens the fill dialog.
  const varsBadge = hasVars ? (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
      title={`${vars.length} variable${vars.length === 1 ? "" : "s"} to fill on copy`}
    >
      <Braces className="h-3 w-3" />
      {vars.length}
    </span>
  ) : null;

  // ---- List view: a compact row, no code preview; click to open. ----
  if (view === "list") {
    return (
      <>
      <article
        id={domId}
        style={accentStyle}
        className={`group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-ring/30 ${focusRing} ${selectRing}`}
      >
        {selectBox}
        {starButton}
        <HoverCard openDelay={350} closeDelay={100}>
          <HoverCardTrigger asChild>
            <button
              onClick={() => onOpen(snippet)}
              className="min-w-0 flex-1 text-left"
            >
              <h3 className="truncate text-sm font-semibold text-foreground">
                {snippet.title}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {snippet.template && (
                  <span className="inline-flex items-center gap-1 font-medium text-primary">
                    <FileText className="h-3 w-3" />
                    Template
                  </span>
                )}
                {snippet.kind === "code" && (
                  <span className="inline-flex items-center gap-1 font-medium">
                    <Code className="h-3 w-3" />
                    Code
                  </span>
                )}
                {hasVars && (
                  <span
                    className="inline-flex items-center gap-1 font-medium"
                    title={`${vars.length} variable${vars.length === 1 ? "" : "s"}`}
                  >
                    <Braces className="h-3 w-3" />
                    {vars.length}
                  </span>
                )}
                <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                  {getLanguageLabel(snippet.language)}
                </span>
                {snippet.model && (
                  <span className="inline-flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    {snippet.model}
                  </span>
                )}
                {tags.length > 0 && (
                  <span className="truncate">{tags.join(", ")}</span>
                )}
              </div>
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-80">
            <p className="mb-1 truncate text-xs font-semibold text-foreground">
              {snippet.title}
            </p>
            {snippet.description && (
              <p className="mb-2 line-clamp-2 text-xs text-muted-foreground">
                {snippet.description}
              </p>
            )}
            <pre className="max-h-52 overflow-hidden whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground">
              {codePreview}
            </pre>
          </HoverCardContent>
        </HoverCard>
        <div className="hidden shrink-0 items-center gap-3 text-xs text-muted-foreground sm:flex">
          {usageMeta}
        </div>
        {actionButtons}
      </article>
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

  // ---- Grid view (default): full card with code preview. ----
  return (
    <>
    <article
      id={domId}
      style={accentStyle}
      className={`group rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/30 ${focusRing} ${selectRing}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        {selectBox && <div className="pt-1">{selectBox}</div>}
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
          {templateBadge}
          {kindBadge}
          {varsBadge}
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
