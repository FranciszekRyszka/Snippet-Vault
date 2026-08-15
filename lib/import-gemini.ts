// Importer for Gemini (formerly Bard) history, as exported via Google Takeout's
// "My Activity" in JSON form (`My Activity.json`). Each activity item for a
// Gemini prompt has a title like `"Prompted <your prompt text>"`; we turn each
// such item into a prompt. Pure, dependency-free, never throws — anything that
// isn't a recognizable Gemini activity export yields [].

export type ImportedPrompt = { title: string; body: string };

const PROMPTED_PREFIX = "Prompted ";

// True when the value looks like a Google "My Activity" item mentioning Gemini
// or Bard (in its `header` or `products`).
function mentionsGemini(item: Record<string, unknown>): boolean {
  const header = typeof item.header === "string" ? item.header : "";
  const products = Array.isArray(item.products)
    ? item.products.filter((p): p is string => typeof p === "string")
    : [];
  const haystack = [header, ...products].join(" ").toLowerCase();
  return haystack.includes("gemini") || haystack.includes("bard");
}

// A Gemini My Activity export is a JSON array of activity items (each with a
// string `title` and `time`), at least one of which is a Gemini/Bard "Prompted"
// entry — the signal that distinguishes it from other Takeout activity files.
export function isGeminiExport(parsed: unknown): boolean {
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  const allActivityItems = parsed.every(
    (i) =>
      !!i &&
      typeof i === "object" &&
      typeof (i as Record<string, unknown>).title === "string" &&
      typeof (i as Record<string, unknown>).time === "string"
  );
  if (!allActivityItems) return false;
  return parsed.some((i) => {
    const item = i as Record<string, unknown>;
    return (
      mentionsGemini(item) &&
      typeof item.title === "string" &&
      item.title.startsWith(PROMPTED_PREFIX)
    );
  });
}

function titleFromBody(body: string): string {
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  const clean = firstLine.trim();
  return clean.length > 80 ? clean.slice(0, 79).trimEnd() + "…" : clean;
}

// Convert a parsed Gemini My Activity export into importable prompts: one per
// "Prompted …" activity item, with the prefix stripped off to leave the prompt.
export function parseGeminiExport(parsed: unknown): ImportedPrompt[] {
  if (!Array.isArray(parsed)) return [];
  const out: ImportedPrompt[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const title = typeof it.title === "string" ? it.title : "";
    // Only Gemini/Bard prompt items; skip searches, opens, and other activity.
    if (!mentionsGemini(it) || !title.startsWith(PROMPTED_PREFIX)) continue;

    const body = title.slice(PROMPTED_PREFIX.length).trim();
    if (!body) continue;
    out.push({ title: (titleFromBody(body) || "Imported prompt").slice(0, 255), body });
  }

  return out;
}
