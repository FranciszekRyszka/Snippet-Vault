"use client";

import { Code2, Moon, Sun, Plus, Settings, Upload } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function Header({
  onNewSnippet,
  onImport,
  onOpenSettings,
}: {
  onNewSnippet: () => void;
  // Opens a file picker to import prompts from a JSON export.
  onImport: () => void;
  // Provided only in the desktop app; when set, a settings button is shown.
  onOpenSettings?: () => void;
}) {
  // resolvedTheme reflects the actual applied theme (light/dark), including when
  // the preference is "system" — reading `theme` there gives "system", making
  // the icon wrong and the first toggle a no-op.
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Code2 className="h-4 w-4 text-primary-foreground" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            SnipVault
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onNewSnippet}
            title="New prompt (Ctrl/⌘+N)"
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            New Prompt
          </button>
          <button
            onClick={onImport}
            title="Import prompts from a JSON file"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Import prompts"
          >
            <Upload className="h-4 w-4" />
          </button>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          {mounted && (
            <button
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
