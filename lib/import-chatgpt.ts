// Importer for ChatGPT's data export (the `conversations.json` file inside the
// "Export data" zip). It turns each conversation into a single reusable prompt:
// the conversation title becomes the entry title, and the *first user message*
// becomes the body — that opening message is the reusable "prompt" that started
// the chat, whereas the assistant's replies and follow-ups are conversation, not
// something you'd want to re-run.
//
// Pure and dependency-free so it's unit-testable and safe to run in either
// runtime. It never throws on malformed input — unknown shapes yield [].

export type ImportedPrompt = { title: string; body: string };

// A ChatGPT export is a JSON array whose elements each carry a `mapping` object
// (the message tree) — the distinctive shape we key on so we don't mistake an
// ordinary array of prompts for a ChatGPT export.
export function isChatGPTExport(parsed: unknown): boolean {
  return (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (c) =>
        !!c &&
        typeof c === "object" &&
        typeof (c as Record<string, unknown>).mapping === "object" &&
        (c as Record<string, unknown>).mapping !== null
    )
  );
}

// A single message node's text, if it's a user message with text content.
// Returns null for assistant/system/tool nodes, empty nodes, and non-text parts.
type UserMessage = { text: string; time: number };

function userMessageFrom(node: unknown): UserMessage | null {
  if (!node || typeof node !== "object") return null;
  const message = (node as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  const author = m.author as Record<string, unknown> | undefined;
  if (!author || author.role !== "user") return null;

  const content = m.content as Record<string, unknown> | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return null;

  // Keep only string parts (a multimodal message can carry image objects too),
  // dropping blanks, and join them into one body.
  const text = parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .trim();
  if (!text) return null;

  const time =
    typeof m.create_time === "number" && Number.isFinite(m.create_time)
      ? m.create_time
      : 0;
  return { text, time };
}

// A short title derived from a prompt body when the conversation has none:
// its first non-empty line, trimmed to a sane length.
function titleFromBody(body: string): string {
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  const clean = firstLine.trim();
  return clean.length > 80 ? clean.slice(0, 79).trimEnd() + "…" : clean;
}

// Convert a parsed ChatGPT export into importable prompts (one per conversation,
// using its first user message). Conversations with no user text are skipped.
export function parseChatGPTExport(parsed: unknown): ImportedPrompt[] {
  if (!Array.isArray(parsed)) return [];
  const out: ImportedPrompt[] = [];

  for (const convo of parsed) {
    if (!convo || typeof convo !== "object") continue;
    const c = convo as Record<string, unknown>;
    const mapping = c.mapping;
    if (!mapping || typeof mapping !== "object") continue;

    // Collect every user message, then take the earliest by timestamp so we get
    // the opening prompt regardless of the mapping's key order.
    const userMessages: UserMessage[] = [];
    for (const node of Object.values(mapping as Record<string, unknown>)) {
      const um = userMessageFrom(node);
      if (um) userMessages.push(um);
    }
    if (userMessages.length === 0) continue;
    userMessages.sort((a, b) => a.time - b.time);
    const body = userMessages[0].text;

    const rawTitle = typeof c.title === "string" ? c.title.trim() : "";
    const title = (rawTitle || titleFromBody(body) || "Imported prompt").slice(
      0,
      255
    );
    out.push({ title, body });
  }

  return out;
}
