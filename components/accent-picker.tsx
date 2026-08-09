"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, Check } from "lucide-react";
import { ACCENTS, getAccent, setAccent, type AccentId } from "@/lib/accent";

// Header control to pick the accent hue. A palette button opens a small popover
// of color swatches; the choice applies live and persists in localStorage.
export function AccentPicker() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [accent, setAccentState] = useState<AccentId>("default");
  const ref = useRef<HTMLDivElement>(null);

  // Read the stored accent only after mount (localStorage is client-only).
  useEffect(() => {
    setMounted(true);
    setAccentState(getAccent());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Avoid rendering the (localStorage-dependent) state on the server.
  if (!mounted) {
    return (
      <button
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
        aria-label="Accent color"
      >
        <Palette className="h-4 w-4" />
      </button>
    );
  }

  const choose = (id: AccentId) => {
    setAccent(id);
    setAccentState(id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Accent color"
        aria-expanded={open}
      >
        <Palette className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-1 rounded-lg border border-border bg-card p-2 shadow-lg">
          <p className="px-1 pb-1.5 text-xs font-medium text-muted-foreground">
            Accent
          </p>
          <div className="flex items-center gap-1.5">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                onClick={() => choose(a.id)}
                title={a.label}
                aria-label={a.label}
                className="flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-card transition-transform hover:scale-110"
                style={{
                  backgroundColor: `hsl(${a.swatch})`,
                  // Highlight the active swatch with a matching ring.
                  ...(accent === a.id
                    ? { boxShadow: `0 0 0 2px hsl(${a.swatch})` }
                    : {}),
                  ["--tw-ring-color" as string]:
                    accent === a.id ? `hsl(${a.swatch})` : "transparent",
                }}
              >
                {accent === a.id && (
                  <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
