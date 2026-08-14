// Shared validation/normalization helpers for the web API routes, so every
// write path (create, update, restore) enforces the same rules and matches the
// desktop backend (src-tauri/src/validation.rs).

// Escape LIKE metacharacters so user input matches literally. Pair with an
// `ESCAPE '\'` clause. Without this, a value containing `%` or `_` acts as a
// wildcard (e.g. searching "100%" or a tag of "%" would match everything).
export function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Normalize a tags payload: coerce to strings, trim, lowercase, drop empties,
// dedupe, cap at 20. Non-string items are ignored rather than throwing.
export function sanitizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  for (const t of tags) {
    if (typeof t !== "string") continue;
    const cleaned = t.trim().toLowerCase();
    if (cleaned) seen.add(cleaned);
  }
  return Array.from(seen).slice(0, 20);
}

export function sanitizeModel(model: unknown): string {
  return typeof model === "string" ? model.trim().slice(0, 100) : "";
}

// Bound a device name (the `last_device` stamp) to a trimmed, length-capped
// string. Mirrors the desktop's MAX_DEVICE_LEN so both sides agree.
export function sanitizeDevice(device: unknown): string {
  return typeof device === "string" ? device.trim().slice(0, 64) : "";
}

// Coerce an entry kind to the allowed set. Anything that isn't exactly "code"
// (missing, unknown, non-string) becomes "prompt" — the safe default for a
// prompt vault. Mirrors the desktop's normalize_kind; never throws.
export function sanitizeKind(kind: unknown): "prompt" | "code" {
  return typeof kind === "string" && kind.trim() === "code" ? "code" : "prompt";
}

// The per-prompt color palette (see lib/prompt-colors.ts). Kept as a literal
// here so this module has no client-code dependency; the two lists must match.
const VALID_COLORS = new Set([
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
]);

// Coerce a color to the allowed palette. Anything outside it (missing, unknown,
// non-string) becomes "" — no color. Mirrors the desktop's normalize_color.
export function sanitizeColor(color: unknown): string {
  return typeof color === "string" && VALID_COLORS.has(color.trim())
    ? color.trim()
    : "";
}

// Parse a route `id` segment as a non-negative integer, or return null. Guards
// against parseInt's lax coercion, where "1e2" -> 1 and "7abc" -> 7 would
// otherwise target the wrong row.
export function parseId(id: string): number | null {
  return /^\d+$/.test(id) ? Number(id) : null;
}

// Accept only a stored-format timestamp ("YYYY-MM-DD HH:MM:SS"); otherwise
// return `fallback`, so a bogus value can't pin a row to the top of the sort.
export function validTimestampOr(
  value: unknown,
  fallback: string | null
): string | null {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value.replace(" ", "T")))
  ) {
    return value;
  }
  return fallback;
}
