"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { loadLanguage } from "@uiw/codemirror-extensions-langs";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTheme } from "next-themes";

// A syntax-highlighting code editor (CodeMirror 6) used for *code* snippets in
// the New/Edit form, so editing matches the highlighted read view. Prompts keep
// the plain textarea (better for prose + the {{variable}} hints). Client-only —
// the form loads it via next/dynamic with ssr:false so it never runs during the
// static-export prerender.

// Map the app's language values (lib/languages.ts) to CodeMirror language keys.
// Anything not listed (or "text") falls back to no language extension.
const LANG_MAP: Record<string, string> = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  java: "java",
  csharp: "csharp",
  cpp: "cpp",
  c: "c",
  go: "go",
  rust: "rust",
  ruby: "ruby",
  php: "php",
  swift: "swift",
  kotlin: "kotlin",
  sql: "sql",
  html: "html",
  css: "css",
  scss: "sass",
  bash: "shell",
  powershell: "powershell",
  yaml: "yaml",
  json: "json",
  xml: "xml",
  toml: "toml",
  dockerfile: "dockerfile",
  graphql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  elixir: "elixir",
  haskell: "haskell",
  scala: "scala",
  perl: "perl",
  markdown: "markdown",
};

type CodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language: string;
  placeholder?: string;
};

export function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
}: CodeEditorProps) {
  const { resolvedTheme } = useTheme();

  const extensions = useMemo(() => {
    const key = LANG_MAP[language];
    // loadLanguage returns a LanguageSupport (or null for an unknown key).
    const ext = key ? loadLanguage(key as Parameters<typeof loadLanguage>[0]) : null;
    return ext ? [ext] : [];
  }, [language]);

  return (
    <div className="overflow-hidden rounded-lg border border-input focus-within:ring-2 focus-within:ring-ring">
      <CodeMirror
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        extensions={extensions}
        theme={resolvedTheme === "dark" ? oneDark : "light"}
        height="288px"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: false,
          autocompletion: false,
        }}
        style={{ fontSize: "13px" }}
      />
    </div>
  );
}
