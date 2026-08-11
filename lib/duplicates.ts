// Duplicate detection: find library entries whose content is effectively the
// same, so a cluttered library can be tidied up. This is a cheap, exact-after-
// normalization match (whitespace-insensitive) — not a semantic/fuzzy compare —
// which reliably catches copy-paste duplicates and reformatting differences
// without false positives. Pure and dependency-light, so it's unit-testable.

import type { Snippet } from "@/lib/tauri-api";

// Normalize a body for comparison: trim the ends and collapse every run of
// whitespace (spaces, tabs, newlines) to a single space. Case is preserved —
// case can be meaningful in a prompt, so we don't want to over-match.
export function normalizeForDup(code: string): string {
  return code.trim().replace(/\s+/g, " ");
}

// Group entries that share the same normalized content. Only groups with more
// than one member are returned (a lone entry isn't a duplicate), empty bodies
// are ignored, and groups are ordered largest-first so the worst offenders lead.
// Entries keep their incoming order within a group.
export function findDuplicateGroups(snippets: Snippet[]): Snippet[][] {
  const groups = new Map<string, Snippet[]>();
  for (const s of snippets) {
    const key = normalizeForDup(s.code);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .sort((a, b) => b.length - a.length);
}
