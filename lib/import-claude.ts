// Importer for Claude's data export (the `conversations.json` from Anthropic's
// "Export data"). Like the ChatGPT importer, each conversation becomes one
// reusable prompt: the conversation name as the title, and the first *human*
// message as the body (assistant replies are conversation, not a reusable
// prompt). Pure, dependency-free, and never throws — unknown shapes yield [].

export type ImportedPrompt = { title: string; body: string };

// A Claude export is a JSON array whose elements each carry a `chat_messages`
// array — the distinctive shape we key on.
export function isClaudeExport(parsed: unknown): boolean {
  return (
    Array.isArray(parsed) &&
    parsed.length > 0 &&
    parsed.every(
      (c) =>
        !!c &&
        typeof c === "object" &&
        Array.isArray((c as Record<string, unknown>).chat_messages)
    )
  );
}

// Extract a message's text: prefer the flat `text`, else join the string parts
// of a structured `content` array (Claude uses `content: [{type:"text",text}]`).
function messageText(m: Record<string, unknown>): string {
  if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
  const content = m.content;
  if (Array.isArray(content)) {
    const text = content
      .map((p) =>
        p && typeof p === "object" && typeof (p as Record<string, unknown>).text === "string"
          ? ((p as Record<string, unknown>).text as string)
          : ""
      )
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "";
}

function titleFromBody(body: string): string {
  const firstLine = body.split("\n").find((l) => l.trim()) ?? "";
  const clean = firstLine.trim();
  return clean.length > 80 ? clean.slice(0, 79).trimEnd() + "…" : clean;
}

// Convert a parsed Claude export into importable prompts (one per conversation,
// its first human message). Conversations with no human text are skipped.
export function parseClaudeExport(parsed: unknown): ImportedPrompt[] {
  if (!Array.isArray(parsed)) return [];
  const out: ImportedPrompt[] = [];

  for (const convo of parsed) {
    if (!convo || typeof convo !== "object") continue;
    const c = convo as Record<string, unknown>;
    const messages = c.chat_messages;
    if (!Array.isArray(messages)) continue;

    // The export lists messages in order; take the first "human" message.
    let body = "";
    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;
      const m = msg as Record<string, unknown>;
      if (m.sender !== "human") continue;
      const text = messageText(m);
      if (text) {
        body = text;
        break;
      }
    }
    if (!body) continue;

    const rawName = typeof c.name === "string" ? c.name.trim() : "";
    const title = (rawName || titleFromBody(body) || "Imported prompt").slice(0, 255);
    out.push({ title, body });
  }

  return out;
}
