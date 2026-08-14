// A tiny, dependency-free line diff used to compare a past prompt version with
// the current one in the History panel. Classic LCS (longest common
// subsequence) over lines, then a backtrack into a run of same/added/removed
// lines. Prompt-sized text only — O(n*m) is fine there.

export type DiffLine = { type: "same" | "add" | "del"; text: string };

// Diff `oldText` → `newText` at line granularity. `del` lines are present in
// the old text but gone from the new; `add` lines are new. Order preserves the
// new text's sequence, with removed lines shown where they used to be.
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i..] and b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: a[i] });
      i++;
    } else {
      out.push({ type: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: a[i++] });
  while (j < m) out.push({ type: "add", text: b[j++] });
  return out;
}

// One row of a side-by-side (two-column) diff. `left`/`right` are the old/new
// line text, or null where that side has no line (a spacer). `changed` marks a
// row that came from an add/del run (rendered in color); unchanged rows show the
// same text on both sides.
export type DiffRow = {
  left: string | null;
  right: string | null;
  changed: boolean;
};

// Rearrange a line diff into aligned two-column rows for a side-by-side view.
// Consecutive deletions and additions are paired up (del on the left, add on the
// right) so an edited line sits on one row; any surplus on either side gets a
// spacer (null) opposite it. Unchanged lines appear on both sides.
export function alignedDiff(oldText: string, newText: string): DiffRow[] {
  const lines = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = () => {
    const k = Math.max(dels.length, adds.length);
    for (let i = 0; i < k; i++) {
      rows.push({
        left: i < dels.length ? dels[i] : null,
        right: i < adds.length ? adds[i] : null,
        changed: true,
      });
    }
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.type === "same") {
      flush();
      rows.push({ left: l.text, right: l.text, changed: false });
    } else if (l.type === "del") {
      dels.push(l.text);
    } else {
      adds.push(l.text);
    }
  }
  flush();
  return rows;
}

// Count of added/removed lines — for a compact "+N −M" summary.
export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === "add") added++;
    else if (l.type === "del") removed++;
  }
  return { added, removed };
}
