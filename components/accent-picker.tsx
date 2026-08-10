"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ACCENTS, getAccent, setAccent, type AccentId } from "@/lib/accent";

// An inline row of accent swatches — the choice applies live and persists in
// localStorage. Lives in the Settings dialog (Appearance). Renders a stable,
// unselected row before mount (localStorage is client-only) to avoid a
// hydration mismatch, then reflects the stored accent.
export function AccentSwatches({ onChoose }: { onChoose?: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [accent, setAccentState] = useState<AccentId>("default");

  useEffect(() => {
    setMounted(true);
    setAccentState(getAccent());
  }, []);

  const choose = (id: AccentId) => {
    setAccent(id);
    setAccentState(id);
    onChoose?.();
  };

  return (
    <div className="flex items-center gap-1.5">
      {ACCENTS.map((a) => {
        const active = mounted && accent === a.id;
        return (
          <button
            key={a.id}
            onClick={() => choose(a.id)}
            title={a.label}
            aria-label={a.label}
            aria-pressed={active}
            className="flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110"
            style={{
              backgroundColor: `hsl(${a.swatch})`,
              ...(active ? { boxShadow: `0 0 0 2px hsl(${a.swatch})` } : {}),
            }}
          >
            {active && (
              <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
            )}
          </button>
        );
      })}
    </div>
  );
}
