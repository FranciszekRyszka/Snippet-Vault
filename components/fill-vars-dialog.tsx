"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Copy } from "lucide-react";
import { parseVars, fillVars, type VarSpec } from "@/lib/prompt-vars";
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
  const vars = useMemo(() => parseVars(code), [code]);
  // Seed each field with the value used last time, falling back to the prompt's
  // declared default. (loadVarValues/parseVars are pure, so computing this once
  // in the initializer is safe.)
  const [values, setValues] = useState<Record<string, string>>(() => {
    const saved = loadVarValues(uuid);
    const init: Record<string, string> = {};
    for (const v of vars) init[v.name] = saved[v.name] ?? v.default;
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const filled = useMemo(() => fillVars(code, values), [code, values]);
  const setValue = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

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
      saveVarValues(uuid, values, vars.map((v) => v.name));
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
          {vars.map((spec, i) => (
            <VarField
              key={spec.name}
              spec={spec}
              value={values[spec.name] ?? ""}
              autoFocus={i === 0}
              onChange={(val) => setValue(spec.name, val)}
            />
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

// One field in the fill dialog, rendered to match the variable's declared type:
// a dropdown for select, a textarea for multiline, a number/date input for those,
// and a plain text input otherwise. The label shows the placeholder name.
function VarField({
  spec,
  value,
  autoFocus,
  onChange,
}: {
  spec: VarSpec;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const fieldClass =
    "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-xs text-muted-foreground">
        {`{{${spec.name}}}`}
      </span>
      {spec.type === "select" ? (
        <select
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={fieldClass}
        >
          {/* Placeholder shown only until a choice is made. */}
          {!spec.options.includes(value) && <option value="">Choose…</option>}
          {spec.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : spec.type === "multiline" ? (
        <textarea
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.name}
          rows={3}
          className={`${fieldClass} resize-y`}
        />
      ) : (
        <input
          autoFocus={autoFocus}
          type={spec.type === "number" ? "number" : spec.type === "date" ? "date" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={spec.name}
          className={fieldClass}
        />
      )}
      {spec.hint && (
        <span className="text-xs text-muted-foreground">{spec.hint}</span>
      )}
    </label>
  );
}
