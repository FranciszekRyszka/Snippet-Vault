// Accent theme: overrides the primary/ring hue. The choice is stored in
// localStorage and applied as a `data-accent` attribute on <html> — set before
// paint by an inline script in the root layout (so there's no color flash), and
// updated live here when the user picks a new one. The CSS lives in globals.css.

export const ACCENTS = [
  { id: "default", label: "Blue", swatch: "221 83% 53%" },
  { id: "violet", label: "Violet", swatch: "262 83% 58%" },
  { id: "emerald", label: "Emerald", swatch: "160 84% 39%" },
  { id: "rose", label: "Rose", swatch: "347 77% 50%" },
  { id: "orange", label: "Orange", swatch: "21 90% 48%" },
  { id: "teal", label: "Teal", swatch: "174 72% 40%" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"];

const KEY = "snipvault:accent";

export function getAccent(): AccentId {
  if (typeof window === "undefined") return "default";
  const a = window.localStorage.getItem(KEY);
  return ACCENTS.some((x) => x.id === a) ? (a as AccentId) : "default";
}

export function setAccent(id: AccentId): void {
  if (typeof window === "undefined") return;
  try {
    if (id === "default") {
      window.localStorage.removeItem(KEY);
      delete document.documentElement.dataset.accent;
    } else {
      window.localStorage.setItem(KEY, id);
      document.documentElement.dataset.accent = id;
    }
  } catch {
    // Storage blocked — accent is a cosmetic preference; ignore.
  }
}

// Inline-script body run in the layout <head> before paint: applies the saved
// accent so the first render already has the right hue (no flash).
export const ACCENT_INIT_SCRIPT = `try{var a=localStorage.getItem('${KEY}');if(a)document.documentElement.dataset.accent=a;}catch(e){}`;
