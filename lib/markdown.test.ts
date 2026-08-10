import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, type InlineNode } from "./markdown";

// Flatten an inline tree into a compact string so assertions read easily:
// text stays as-is, wrappers become tags, e.g. "hi <strong>there</strong>".
function inlineToString(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.value;
        case "code":
          return `<code>${n.value}</code>`;
        case "strong":
          return `<strong>${inlineToString(n.children)}</strong>`;
        case "em":
          return `<em>${inlineToString(n.children)}</em>`;
        case "link":
          return `<a:${n.href}>${inlineToString(n.children)}</a>`;
      }
    })
    .join("");
}

describe("parseInline", () => {
  it("renders bold, italic, and inline code", () => {
    expect(inlineToString(parseInline("**bold** and *italic* and `code`"))).toBe(
      "<strong>bold</strong> and <em>italic</em> and <code>code</code>"
    );
  });

  it("supports underscore emphasis", () => {
    expect(inlineToString(parseInline("__b__ and _i_"))).toBe(
      "<strong>b</strong> and <em>i</em>"
    );
  });

  it("renders a safe link", () => {
    expect(inlineToString(parseInline("see [docs](https://example.com)"))).toBe(
      "see <a:https://example.com>docs</a>"
    );
  });

  it("strips a javascript: link but keeps the label text", () => {
    // eslint-disable-next-line no-script-url
    expect(inlineToString(parseInline("[click](javascript:evil)"))).toBe(
      "click"
    );
  });

  it("leaves prompt variables untouched", () => {
    expect(inlineToString(parseInline("Hello {{name}}, welcome"))).toBe(
      "Hello {{name}}, welcome"
    );
  });

  it("does not treat an unclosed marker as formatting", () => {
    expect(inlineToString(parseInline("a * b"))).toBe("a * b");
  });
});

describe("parseMarkdown", () => {
  it("parses a heading", () => {
    const blocks = parseMarkdown("## Title");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
  });

  it("parses a fenced code block with a language", () => {
    const blocks = parseMarkdown("```js\nconst x = 1;\n```");
    expect(blocks[0]).toEqual({
      type: "code",
      lang: "js",
      value: "const x = 1;",
    });
  });

  it("keeps markdown characters literal inside a code fence", () => {
    const blocks = parseMarkdown("```\n**not bold**\n```");
    expect(blocks[0]).toEqual({
      type: "code",
      lang: null,
      value: "**not bold**",
    });
  });

  it("parses an unordered list", () => {
    const blocks = parseMarkdown("- one\n- two");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    expect((blocks[0] as { items: InlineNode[][] }).items).toHaveLength(2);
  });

  it("parses an ordered list", () => {
    const blocks = parseMarkdown("1. a\n2. b");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: true });
  });

  it("parses a blockquote recursively", () => {
    const blocks = parseMarkdown("> quoted **text**");
    expect(blocks[0]).toMatchObject({ type: "blockquote" });
    const inner = (blocks[0] as { children: unknown[] }).children;
    expect(inner[0]).toMatchObject({ type: "paragraph" });
  });

  it("parses a horizontal rule", () => {
    expect(parseMarkdown("---")[0]).toEqual({ type: "hr" });
  });

  it("groups consecutive lines into one paragraph and splits on blank lines", () => {
    const blocks = parseMarkdown("line one\nline two\n\nsecond para");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[1].type).toBe("paragraph");
  });

  it("returns nothing for empty input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n   \n")).toEqual([]);
  });
});
