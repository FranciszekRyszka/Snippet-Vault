"use client";

import { useEffect, useMemo } from "react";
import { X, BarChart3, Flame, Clock, Moon } from "lucide-react";
import { formatCount } from "@/lib/prompt-stats";
import type { Snippet } from "@/lib/tauri-api";

// Parse a stored UTC "YYYY-MM-DD HH:MM:SS" timestamp into a compact relative
// label ("3d ago"). Returns "—" for null/unparseable values.
function timeAgo(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value.replace(" ", "T") + "Z");
  const ms = Date.now() - d.getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

// A small usage-insights panel over the whole library: totals plus most-used,
// recently-used, and never-used lists. Reads the already-loaded snippets — no
// fetch. Clicking an entry opens its detail.
export function InsightsDialog({
  snippets,
  onClose,
  onOpen,
}: {
  snippets: Snippet[];
  onClose: () => void;
  onOpen: (snippet: Snippet) => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const { totalCopies, mostUsed, recentlyUsed, neverUsed } = useMemo(() => {
    const totalCopies = snippets.reduce((n, s) => n + (s.copy_count || 0), 0);
    const mostUsed = snippets
      .filter((s) => s.copy_count > 0)
      .sort((a, b) => b.copy_count - a.copy_count)
      .slice(0, 5);
    const recentlyUsed = snippets
      .filter((s) => s.last_used_at)
      .sort((a, b) => (a.last_used_at! < b.last_used_at! ? 1 : -1))
      .slice(0, 5);
    const neverUsed = snippets.filter((s) => s.copy_count === 0);
    return { totalCopies, mostUsed, recentlyUsed, neverUsed };
  }, [snippets]);

  const open = (s: Snippet) => {
    onOpen(s);
    onClose();
  };

  const Row = ({ s, meta }: { s: Snippet; meta: string }) => (
    <button
      onClick={() => open(s)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {s.title}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <BarChart3 className="h-4 w-4" />
            Usage insights
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {snippets.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            Nothing to report yet — add some prompts first.
          </p>
        ) : (
          <div className="flex flex-col gap-5 p-5">
            {/* Totals */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Prompts", value: formatCount(snippets.length) },
                { label: "Total copies", value: formatCount(totalCopies) },
                { label: "Never used", value: formatCount(neverUsed.length) },
              ].map((t) => (
                <div
                  key={t.label}
                  className="rounded-lg border border-border bg-background p-3"
                >
                  <div className="text-lg font-semibold text-foreground">
                    {t.value}
                  </div>
                  <div className="text-xs text-muted-foreground">{t.label}</div>
                </div>
              ))}
            </div>

            {/* Most used */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Flame className="h-4 w-4 text-amber-500" />
                Most used
              </h3>
              {mostUsed.length > 0 ? (
                <div className="flex flex-col">
                  {mostUsed.map((s) => (
                    <Row
                      key={s.id}
                      s={s}
                      meta={`${formatCount(s.copy_count)}×`}
                    />
                  ))}
                </div>
              ) : (
                <p className="px-2 text-xs text-muted-foreground">
                  No prompts copied yet.
                </p>
              )}
            </section>

            {/* Recently used */}
            <section>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Clock className="h-4 w-4 text-primary" />
                Recently used
              </h3>
              {recentlyUsed.length > 0 ? (
                <div className="flex flex-col">
                  {recentlyUsed.map((s) => (
                    <Row key={s.id} s={s} meta={timeAgo(s.last_used_at)} />
                  ))}
                </div>
              ) : (
                <p className="px-2 text-xs text-muted-foreground">
                  No prompts copied yet.
                </p>
              )}
            </section>

            {/* Never used */}
            {neverUsed.length > 0 && (
              <section>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Moon className="h-4 w-4 text-muted-foreground" />
                  Never used ({formatCount(neverUsed.length)})
                </h3>
                <div className="flex flex-col">
                  {neverUsed.slice(0, 5).map((s) => (
                    <Row key={s.id} s={s} meta="never" />
                  ))}
                </div>
                {neverUsed.length > 5 && (
                  <p className="px-2 pt-1 text-xs text-muted-foreground">
                    +{formatCount(neverUsed.length - 5)} more
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
