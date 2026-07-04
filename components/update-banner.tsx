"use client";

import { useState } from "react";
import { Download, X, Loader2, RefreshCw } from "lucide-react";
import { relaunchApp, type AvailableUpdate } from "@/lib/updater";

type UpdateBannerProps = {
  update: AvailableUpdate;
  onDismiss: () => void;
};

// Subtle top-of-page nudge shown when an update was found on startup.
export function UpdateBanner({ update, onDismiss }: UpdateBannerProps) {
  const [phase, setPhase] = useState<"idle" | "installing" | "done" | "error">(
    "idle"
  );
  const [percent, setPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setError(null);
    setPhase("installing");
    try {
      await update.install((p) => setPercent(p));
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const handleRelaunch = async () => {
    try {
      await relaunchApp();
    } catch (err) {
      // The update is installed; only the automatic restart failed.
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm">
      <Download className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1 text-foreground">
        {phase === "done" ? (
          error ? (
            <>
              Update installed, but the restart failed: {error}. Please reopen
              the app manually.
            </>
          ) : (
            <>Update to v{update.version} installed — restart to apply.</>
          )
        ) : phase === "error" ? (
          <>Update failed: {error}</>
        ) : (
          <>
            <span className="font-medium">Version {update.version}</span> is
            available (you have {update.currentVersion}).
          </>
        )}
      </span>

      <div className="flex items-center gap-2">
        {phase === "done" ? (
          <button
            type="button"
            onClick={handleRelaunch}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Restart now
          </button>
        ) : (
          <button
            type="button"
            onClick={handleInstall}
            disabled={phase === "installing"}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {phase === "installing" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {percent === null ? "Downloading…" : `Downloading ${percent}%`}
              </>
            ) : phase === "error" ? (
              "Retry"
            ) : (
              "Update now"
            )}
          </button>
        )}

        {phase !== "installing" && (
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
