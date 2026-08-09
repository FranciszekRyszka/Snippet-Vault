"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Copy } from "lucide-react";
import { extractVars, fillVars } from "@/lib/prompt-vars";
import { loadVarValues, saveVarValues } from "@/lib/var-store";

// A small modal for filling a prompt's {{variables}} before copying. One input
// per variable, a live preview of the substituted text, and "Copy filled".
// Rendered above the detail view (z-60) when a prompt with variables is copied.
// The values are remembered per-prompt (by `uuid`) and pre-filled next time.
export function FillVarsDialog({
  uuid,
  title,
  code,
  onClose,
  onCopied,
}: {
  uuid: string;
  title: string;
  code: string;
  onClose: () => void;
  // Called after the filled text is successfully copied (records usage, etc.).
  onCopied: () => void;
}) {
  const vars = useMemo(() => extractVars(code), [code]);
  // Seed with the values used the last time this prompt was filled.
  const [values, setValues] = useState<Record<string, string>>(() =>
    loadVarValues(uuid),
  );
  const [error, setError] = useState<string | null>(null);
  const filled = useMemo(() => fillVars(code, values), [code, values]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const copyFilled = async () => {
    try {
      await navigator.clipboard.writeText(filled);
      saveVarValues(uuid, values, vars);
      onCopied();
      onClose();
    } catch (err) {
      console.error("Copy failed:", err);
      setError("Couldn't copy — the clipboard may be blocked.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              Fill variables
            </h2>
            <p className="truncate text-xs text-muted-foreground">{title}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-5">
          {vars.map((name, i) => (
            <label key={name} className="flex flex-col gap-1">
              <span className="font-mono text-xs text-muted-foreground">
                {`{{${name}}}`}
              </span>
              <input
                autoFocus={i === 0}
                value={values[name] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [name]: e.target.value }))
                }
                placeholder={name}
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          ))}

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              Preview
            </p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
              {filled}
            </pre>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={copyFilled}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Copy className="h-4 w-4" />
            Copy filled
          </button>
        </div>
      </div>
    </div>
  );
}
