"use client";

import { useMemo, useState } from "react";
import { Copy, Check } from "lucide-react";
import { segmentByVars } from "@/lib/prompt-vars";

// Renders a prompt body with its {{placeholders}} visually highlighted, so it's
// obvious what still needs filling before copying. Used for prompts in the detail
// view's Raw mode (code snippets keep the syntax-highlighted CodeBlock). The
// placeholder grammar (incl. typed/default variables) lives in lib/prompt-vars,
// so segmentByVars there splits the body into text/placeholder runs for us.

type PromptBodyProps = {
  code: string;
  maxHeight?: string;
  onCopied?: () => void;
};

export function PromptBody({ code, maxHeight = "400px", onCopied }: PromptBodyProps) {
  const [copied, setCopied] = useState(false);
  const segments = useMemo(() => segmentByVars(code), [code]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      onCopied?.();
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Clipboard can be blocked (permissions/insecure context); don't fake it.
      console.error("Copy failed:", err);
    }
  };

  return (
    <div className="group relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-secondary/80 text-muted-foreground opacity-0 backdrop-blur-sm transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100"
        aria-label="Copy prompt"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <div
        className="overflow-auto rounded-lg border border-border bg-muted/50"
        style={{ maxHeight }}
      >
        <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed text-foreground">
          {segments.map((seg, i) =>
            seg.isVar ? (
              <mark
                key={i}
                className="rounded bg-primary/15 px-0.5 font-medium text-primary"
              >
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            )
          )}
        </pre>
      </div>
    </div>
  );
}
