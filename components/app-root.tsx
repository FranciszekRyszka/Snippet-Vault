"use client";

import { useEffect, useState } from "react";
import { SnippetsDashboard } from "@/components/snippets-dashboard";
import { QuickCapture } from "@/components/quick-capture";
import { isQuickWindow } from "@/lib/tauri-api";

// The desktop app runs two webviews off the same static bundle: the main
// window and the always-on-top "quick capture" pop-up. They're told apart by
// the Tauri window label (resolved after mount, so this stays SSR/export-safe).
// On the web there's only ever the main dashboard.
export function AppRoot() {
  const [mode, setMode] = useState<"main" | "quick" | null>(null);

  useEffect(() => {
    let cancelled = false;
    isQuickWindow()
      .then((quick) => {
        if (!cancelled) setMode(quick ? "quick" : "main");
      })
      .catch(() => {
        if (!cancelled) setMode("main");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One frame of nothing while the window identity resolves. The dashboard has
  // its own load state, so this is invisible in the main window; it avoids a
  // flash of the full dashboard inside the small quick-capture window.
  if (mode === null) return null;
  return mode === "quick" ? <QuickCapture /> : <SnippetsDashboard />;
}
