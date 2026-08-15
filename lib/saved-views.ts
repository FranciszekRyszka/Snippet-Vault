// Saved searches ("smart views"): a named snapshot of the dashboard's filter
// combo, persisted locally so a frequent filter ("model=claude, tag=refactor")
// is one click away. Stored in localStorage — personal and per-install, not
// synced. Pure and SSR-safe, so it's unit-testable.

export type ViewFilters = {
  search: string;
  searchMode: string;
  language: string;
  activeTag: string;
  favoritesOnly: boolean;
  activeModel: string;
  // Active collection (folder) filter ("" = all). Optional in older saved
  // entries; callers coalesce a missing value to "".
  activeCollection: string;
  kind: "all" | "prompt" | "code";
  sort: string;
};

export type SavedView = { id: string; name: string; filters: ViewFilters };

const KEY = "snipvault:views";

// Whether a filter combo actually narrows anything — used to disable "save" on
// an empty view.
export function hasActiveFilters(f: ViewFilters): boolean {
  return (
    !!f.search ||
    !!f.language ||
    !!f.activeTag ||
    f.favoritesOnly ||
    !!f.activeModel ||
    !!f.activeCollection ||
    f.kind !== "all" ||
    (f.sort !== "recent" && !!f.sort)
  );
}

export function loadViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep only well-formed entries so a corrupt cell can't break the UI.
    return parsed.filter(
      (v): v is SavedView =>
        !!v &&
        typeof v === "object" &&
        typeof (v as SavedView).id === "string" &&
        typeof (v as SavedView).name === "string" &&
        !!(v as SavedView).filters &&
        typeof (v as SavedView).filters === "object"
    );
  } catch {
    return [];
  }
}

function write(views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(views));
  } catch {
    // Storage full/unavailable — saving views is best-effort.
  }
}

// Add (or, for a duplicate name, replace) a view and return the new list.
export function addView(name: string, filters: ViewFilters): SavedView[] {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return loadViews();
  const others = loadViews().filter(
    (v) => v.name.toLowerCase() !== trimmed.toLowerCase()
  );
  const view: SavedView = {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()),
    name: trimmed,
    filters,
  };
  const next = [...others, view];
  write(next);
  return next;
}

export function removeView(id: string): SavedView[] {
  const next = loadViews().filter((v) => v.id !== id);
  write(next);
  return next;
}
