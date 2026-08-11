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

// One entry for a whole-library Markdown document. Unlike toMarkdown, every
// entry gets a `## title` heading (so code snippets aren't headingless in the
// combined doc) and an optional italic meta line (language · tags).
type LibraryEntry = MarkdownInput & { tags?: string[] };

function entryToMarkdown(s: LibraryEntry): string {
  const fence = "```";
  const lang = s.language && s.language !== "text" ? s.language : "";
  const parts = [`## ${s.title}`.trim()];

  const metaBits: string[] = [];
  if (s.language && s.language !== "text") metaBits.push(s.language);
  if (s.tags && s.tags.length) metaBits.push(s.tags.map((t) => `#${t}`).join(" "));
  if (metaBits.length) parts.push(`_${metaBits.join(" · ")}_`);

  if (s.description && s.description.trim()) parts.push(s.description.trim());

  parts.push(s.kind === "code" ? `${fence}${lang}\n${s.code}\n${fence}` : s.code);
  return parts.join("\n\n");
}

// Render the whole library as a single Markdown document: a title, a small
// export summary, then every entry separated by a horizontal rule. Pure and
// side-effect free (the date is passed in so it stays testable).
export function libraryToMarkdown(
  snippets: LibraryEntry[],
  exportedOn?: string
): string {
  const count = snippets.length;
  const summary = `_${count} ${count === 1 ? "entry" : "entries"}${
    exportedOn ? ` · exported ${exportedOn}` : ""
  }_`;
  const header = `# SnipVault library\n\n${summary}`;
  return [header, ...snippets.map(entryToMarkdown)].join("\n\n---\n\n");
}
