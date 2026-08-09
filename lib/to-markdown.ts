// Render a snippet as Markdown for pasting into docs, issues, or chat. A code
// snippet becomes a fenced code block tagged with its language; a prompt becomes
// a heading, its optional description, then the body. Pure and side-effect free.

type MarkdownInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  kind: "prompt" | "code";
};

export function toMarkdown(s: MarkdownInput): string {
  const fence = "```";
  // "text" is our default/placeholder language — leave the fence untagged for it.
  const lang = s.language && s.language !== "text" ? s.language : "";

  if (s.kind === "code") {
    return `${fence}${lang}\n${s.code}\n${fence}`;
  }

  // Prompt: heading + description + body (the body is left as-is since prompts
  // are often already prose/Markdown).
  const parts = [`# ${s.title}`.trim()];
  if (s.description && s.description.trim()) parts.push(s.description.trim());
  parts.push(s.code);
  return parts.join("\n\n");
}
