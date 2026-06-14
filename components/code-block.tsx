"use client";

import { useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import hljs from "highlight.js";

type CodeBlockProps = {
  code: string;
  language: string;
  maxHeight?: string;
};

export function CodeBlock({
  code,
  language,
  maxHeight = "400px",
}: CodeBlockProps) {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.removeAttribute("data-highlighted");
      hljs.highlightElement(codeRef.current);
    }
  }, [code, language]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-secondary/80 text-muted-foreground opacity-0 backdrop-blur-sm transition-all hover:bg-secondary hover:text-foreground group-hover:opacity-100"
        aria-label="Copy code"
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
        <pre className="p-4 text-[13px] leading-relaxed">
          <code
            ref={codeRef}
            className={`language-${language} !bg-transparent !p-0 font-mono`}
          >
            {code}
          </code>
        </pre>
      </div>
    </div>
  );
}
