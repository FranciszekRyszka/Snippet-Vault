// A tiny, dependency-free Markdown renderer for prompt previews.
//
// Prompts are frequently written in Markdown, so the detail view offers a
// rendered preview. Rather than pull in a Markdown library + an HTML sanitizer,
// this parses a *safe subset* into a block tree that the React view renders as
// real elements — never via `innerHTML`/`dangerouslySetInnerHTML` — so untrusted
// prompt text (imported, drag-dropped, or synced from another user once
// multi-user lands) can't inject markup or scripts. Link targets are additionally
// scheme-checked so `javascript:`/`data:` URLs can't slip through.
//
// It is deliberately NOT a spec-complete CommonMark parser; it covers what
// prompts actually use: ATX headings, paragraphs, bold/italic/inline-code,
// links, fenced code, blockquotes, ordered/unordered lists, and horizontal
// rules. Everything else falls through as plain text.

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type Block =
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "code"; lang: string | null; value: string }
  | { type: "blockquote"; children: Block[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "hr" };

const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const QUOTE_RE = /^\s*>/;
const LIST_RE = /^\s*([-*+]|\d+[.)])\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;
const FENCE_RE = /^(```+|~~~+)\s*([\w.+#-]*)\s*$/;

// Only these schemes are allowed on a rendered link. Anything with a different
// explicit scheme (javascript:, data:, vbscript:, …) is rejected; scheme-less
// links (relative paths, #anchors) are passed through unchanged.
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return /^(https?|mailto):/i.test(trimmed) ? trimmed : null;
  }
  return trimmed || null;
}

function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  );
}

// The number of consecutive `ch` characters starting at `from`.
function countRun(src: string, from: number, ch: string): number {
  let n = 0;
  while (src[from + n] === ch) n++;
  return n;
}

// Index of the next occurrence of `marker` at or after `from`, or -1.
function findClose(src: string, from: number, marker: string): number {
  for (let i = from; i <= src.length - marker.length; i++) {
    if (src.startsWith(marker, i)) return i;
  }
  return -1;
}

// Match a `[text](href)` link starting at `[`. Returns the raw text, raw href,
// and the index just past the closing `)`, or null if it isn't a well-formed
// link. Bracket-balances the label so `[a [b] c](url)` works.
function matchLink(
  src: string,
  start: number
): { text: string; href: string; end: number } | null {
  let depth = 0;
  let textEnd = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        textEnd = i;
        break;
      }
    }
  }
  if (textEnd === -1 || src[textEnd + 1] !== "(") return null;
  const parenEnd = src.indexOf(")", textEnd + 2);
  if (parenEnd === -1) return null;
  return {
    text: src.slice(start + 1, textEnd),
    href: src.slice(textEnd + 2, parenEnd),
    end: parenEnd + 1,
  };
}

// Parse inline formatting (code, links, bold, italic) within a run of text.
// Newlines become spaces (soft breaks) — prompts don't rely on hard breaks.
export function parseInline(src: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = "";
  const flush = () => {
    if (text) {
      nodes.push({ type: "text", value: text });
      text = "";
    }
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    // Inline code: `code`, or ``code with ` inside`` (longer runs win).
    if (c === "`") {
      const len = countRun(src, i, "`");
      const fence = "`".repeat(len);
      const close = src.indexOf(fence, i + len);
      if (close !== -1) {
        flush();
        nodes.push({ type: "code", value: src.slice(i + len, close).trim() });
        i = close + len;
        continue;
      }
    }

    // Link: [text](href)
    if (c === "[") {
      const link = matchLink(src, i);
      if (link) {
        const href = safeHref(link.href);
        const children = parseInline(link.text);
        flush();
        if (href) nodes.push({ type: "link", href, children });
        else nodes.push(...children); // unsafe target → keep the label as text
        i = link.end;
        continue;
      }
    }

    // Strong: **text** or __text__
    if ((c === "*" || c === "_") && src[i + 1] === c) {
      const marker = c + c;
      const close = findClose(src, i + 2, marker);
      if (close !== -1 && close > i + 2) {
        flush();
        nodes.push({ type: "strong", children: parseInline(src.slice(i + 2, close)) });
        i = close + 2;
        continue;
      }
    }

    // Emphasis: *text* or _text_
    if (c === "*" || c === "_") {
      const close = findClose(src, i + 1, c);
      if (close !== -1 && close > i + 1) {
        flush();
        nodes.push({ type: "em", children: parseInline(src.slice(i + 1, close)) });
        i = close + 1;
        continue;
      }
    }

    if (c === "\n") {
      text += " ";
      i++;
      continue;
    }

    text += c;
    i++;
  }
  flush();
  return nodes;
}

// Parse a Markdown document into a flat list of block nodes.
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Fenced code block.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const marker = fence[1][0]; // ` or ~
      const closeRe = new RegExp(`^\\${marker}{3,}\\s*$`);
      const lang = fence[2] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // consume the closing fence (or fall off the end)
      blocks.push({ type: "code", lang, value: body.join("\n") });
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Heading.
    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      i++;
      continue;
    }

    // Blockquote: gather the run, strip one level of `>`, parse recursively.
    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", children: parseMarkdown(quoted.join("\n")) });
      continue;
    }

    // List: consecutive items of the same kind (ordered vs unordered).
    if (LIST_RE.test(line)) {
      const ordered = ORDERED_RE.test(line);
      const items: InlineNode[][] = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        if (ORDERED_RE.test(lines[i]) !== ordered) break;
        items.push(parseInline(lines[i].replace(LIST_RE, "")));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Paragraph: consecutive lines until a blank line or another block start.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }

  return blocks;
}
