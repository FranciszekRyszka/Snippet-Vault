"use client";

import { useState } from "react";
import { Database, FolderOpen, FilePlus2, Loader2 } from "lucide-react";
import { initializeNewDb, useExistingDb } from "@/lib/tauri-api";

type DbSetupDialogProps = {
  // Called once a database has been created or selected.
  onComplete: () => void;
};

// First-run modal shown (desktop only) when no database has been configured.
// Lets the user create a brand-new database or point to an existing snippets.db.
export function DbSetupDialog({ onComplete }: DbSetupDialogProps) {
  const [busy, setBusy] = useState<"new" | "existing" | "default" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create a new database at a location the user picks via a native save dialog.
  const handleCreateNew = async () => {
    setError(null);
    setBusy("new");
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const selected = await save({
        title: "Choose where to save your new database",
        defaultPath: "snippets.db",
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      if (typeof selected !== "string") {
        // User cancelled the picker.
        setBusy(null);
        return;
      }
      await initializeNewDb(selected);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  // Fallback for users who don't care where it lives: use the default app-data
  // folder without prompting for a location.
  const handleCreateDefault = async () => {
    setError(null);
    setBusy("default");
    try {
      await initializeNewDb();
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  const handleChooseExisting = async () => {
    setError(null);
    setBusy("existing");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Select your existing SnipVault database",
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3"] }],
      });
      if (typeof selected !== "string") {
        // User cancelled the picker.
        setBusy(null);
        return;
      }
      await useExistingDb(selected);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg">
        <div className="mb-2 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <Database className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">
            Welcome to SnipVault
          </h2>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          Choose where your snippets are stored. You can change this later in
          Settings.
        </p>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleCreateNew}
            disabled={busy !== null}
            className="flex items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50"
          >
            <FilePlus2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                Create a new database
                {busy === "new" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Start fresh. Pick the folder where your snippets.db is saved.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={handleChooseExisting}
            disabled={busy !== null}
            className="flex items-start gap-3 rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50"
          >
            <FolderOpen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                Use an existing database
                {busy === "existing" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Select a snippets.db you already have (e.g. in a synced folder).
              </p>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={handleCreateDefault}
          disabled={busy !== null}
          className="mt-3 inline-flex items-center gap-1.5 self-start text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
        >
          {busy === "default" && <Loader2 className="h-3 w-3 animate-spin" />}
          Or just use the default app data folder
        </button>

        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
