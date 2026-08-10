"use client";

import { useEffect, useState } from "react";
import {
  Star,
  StarOff,
  Code,
  FileText,
  Download,
  Trash2,
  X,
  CheckCheck,
  Loader2,
} from "lucide-react";

type BulkActionsBarProps = {
  count: number; // how many are selected
  allSelected: boolean; // whether every visible entry is selected
  busy: boolean; // a bulk operation is in flight
  onSelectAll: () => void;
  onClear: () => void;
  onClose: () => void;
  onFavorite: (favorite: boolean) => void;
  onSetKind: (kind: "prompt" | "code") => void;
  onExport: () => void;
  onDelete: () => void;
};

// The action bar shown while in selection mode. Delete is two-step (it swaps the
// bar for a confirm prompt) so a bulk delete can't happen on a single stray
// click. Deletes are soft — the entries land in Trash — but a confirm is still
// warranted for a batch.
export function BulkActionsBar({
  count,
  allSelected,
  busy,
  onSelectAll,
  onClear,
  onClose,
  onFavorite,
  onSetKind,
  onExport,
  onDelete,
}: BulkActionsBarProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // If the selection is emptied out from under us, drop the confirm state.
  useEffect(() => {
    if (count === 0) setConfirmingDelete(false);
  }, [count]);

  const btn =
    "flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50";

  return (
    <div className="fixed bottom-4 left-1/2 z-[55] flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 shadow-lg">
      <span className="flex items-center gap-1.5 pr-1 text-sm font-medium text-foreground">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {count > 0 ? `${count} selected` : "Select entries"}
      </span>

      {count === 0 ? (
        <>
          <button onClick={onSelectAll} className={btn} title="Select all visible">
            <CheckCheck className="h-3.5 w-3.5" />
            Select all
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Exit selection mode"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      ) : confirmingDelete ? (
        <>
          <span className="text-sm text-muted-foreground">
            Delete {count}? They&apos;ll move to Trash.
          </span>
          <button
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <button
            onClick={() => setConfirmingDelete(false)}
            disabled={busy}
            className={btn}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            onClick={onSelectAll}
            disabled={busy || allSelected}
            className={btn}
            title="Select all visible"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            All
          </button>
          <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
          <button onClick={() => onFavorite(true)} disabled={busy} className={btn}>
            <Star className="h-3.5 w-3.5" />
            Pin
          </button>
          <button onClick={() => onFavorite(false)} disabled={busy} className={btn}>
            <StarOff className="h-3.5 w-3.5" />
            Unpin
          </button>
          <button onClick={() => onSetKind("prompt")} disabled={busy} className={btn}>
            <FileText className="h-3.5 w-3.5" />
            Prompt
          </button>
          <button onClick={() => onSetKind("code")} disabled={busy} className={btn}>
            <Code className="h-3.5 w-3.5" />
            Code
          </button>
          <button onClick={onExport} disabled={busy} className={btn}>
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-destructive/40 px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
          <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" />
          <button onClick={onClear} disabled={busy} className={btn}>
            Clear
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            aria-label="Exit selection mode"
          >
            <X className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
