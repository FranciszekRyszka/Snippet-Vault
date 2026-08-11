// Prompt links: `[[Another prompt's title]]` references between prompts, so a
// system prompt can point at its variants or a chain of steps can reference each
// other. Like {{variables}}, links are derived from the body at view time —
// there's no stored schema — and they're a **prompt-only** concept: code
// snippets legitimately contain `[[ ... ]]` (e.g. a bash test), so link parsing
// is only ever applied to prompts by the callers.
//
// Pure and dependency-light (only the shared Snippet type), so it's unit-testable.

import type { Snippet } from "@/lib/tauri-api";

// [[ ... ]] with at least one non-bracket, non-newline char inside. Lazy so
// adjacent links don't merge; the capture is trimmed by the caller helpers.
const LINK_RE = /\[\[([^[\]\n]+?)\]\]/g;

// The distinct link targets in a body, trimmed, in first-seen order. Matching is
// case-insensitive for de-duplication, but the original text of the first
// occurrence is preserved for display.
export function extractLinks(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(LINK_RE)) {
    const title = m[1].trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(title);
    }
  }
  return out;
}

// Normalize a title for matching: trimmed and case-insensitive.
function norm(title: string): string {
  return title.trim().toLowerCase();
}

// The first snippet whose title matches `title` (case-insensitive), or undefined
// when nothing matches. Titles aren't guaranteed unique, so "first wins".
export function resolveLink(
  title: string,
  snippets: Snippet[]
): Snippet | undefined {
  const t = norm(title);
  if (!t) return undefined;
  return snippets.find((s) => norm(s.title) === t);
}

// The prompts that link TO `snippet` (backlinks): other entries whose body
// contains a `[[title]]` resolving to this snippet's title. Only **prompts** are
// considered as sources — a code snippet's `[[ ... ]]` is literal syntax, not a
// link — and the snippet itself is never counted.
export function backlinksFor(snippet: Snippet, snippets: Snippet[]): Snippet[] {
  const target = norm(snippet.title);
  if (!target) return [];
  return snippets.filter(
    (s) =>
      s.id !== snippet.id &&
      s.kind !== "code" &&
      extractLinks(s.code).some((l) => norm(l) === target)
  );
}
