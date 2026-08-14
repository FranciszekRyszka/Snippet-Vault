"use client";

import { useMemo } from "react";
import { alignedDiff } from "@/lib/diff";

// A side-by-side (two-column) diff of `oldText` → `newText`: the old version on
// the left with removed lines in red, the new version on the right with added
// lines in green, unchanged lines mirrored on both sides. Edited lines sit on
// the same row (see `alignedDiff`); a spacer fills the empty side of a pure
// insertion or deletion. Complements the inline DiffBlock in the History panel.
export function SplitDiffBlock({
  oldText,
  newText,
}: {
  oldText: string;
  newText: string;
}) {
  const rows = useMemo(() => alignedDiff(oldText, newText), [oldText, newText]);

  const cell = (text: string | null, changed: boolean, side: "left" | "right") => {
    // A spacer (no line on this side) gets a faint striped fill.
    if (text === null) {
      return <div className="bg-muted/20" aria-hidden />;
    }
    const tone = !changed
      ? "text-foreground"
      : side === "left"
        ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
        : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    return (
      <div className={`px-2 ${tone}`}>
        <span className="whitespace-pre-wrap break-words">{text || " "}</span>
      </div>
    );
  };

  return (
    <div className="max-h-64 overflow-auto rounded-md bg-muted/40 text-xs leading-relaxed">
      <div className="grid grid-cols-2">
        {rows.map((r, i) => (
          <div key={i} className="contents">
            {cell(r.left, r.changed, "left")}
            {cell(r.right, r.changed, "right")}
          </div>
        ))}
      </div>
    </div>
  );
}
