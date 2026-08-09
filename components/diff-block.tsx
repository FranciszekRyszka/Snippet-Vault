"use client";

import { useMemo } from "react";
import { diffLines } from "@/lib/diff";

// A compact line-level diff of `oldText` → `newText`: removed lines in red,
// added lines in green, unchanged in the default color. Used in the History
// panel to show what changed between a past version and the current one.
export function DiffBlock({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const lines = useMemo(() => diffLines(oldText, newText), [oldText, newText]);

  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-xs leading-relaxed">
      {lines.map((l, i) => (
        <div
          key={i}
          className={
            l.type === "add"
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : l.type === "del"
                ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                : "text-foreground"
          }
        >
          <span className="select-none opacity-50">
            {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}
          </span>
          {/* Keep blank lines from collapsing so the diff stays aligned. */}
          <span className="whitespace-pre-wrap break-words">{l.text || " "}</span>
        </div>
      ))}
    </pre>
  );
}
