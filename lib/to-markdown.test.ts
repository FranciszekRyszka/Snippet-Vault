import { describe, expect, it } from "vitest";
import { toMarkdown, libraryToMarkdown } from "./to-markdown";

describe("toMarkdown", () => {
  it("wraps a code snippet in a language-tagged fence", () => {
    expect(
      toMarkdown({
        title: "hi",
        code: "const x = 1;",
        language: "javascript",
        kind: "code",
      })
    ).toBe("```javascript\nconst x = 1;\n```");
  });

  it("leaves the fence untagged for plain-text code", () => {
    expect(
      toMarkdown({ title: "t", code: "plain", language: "text", kind: "code" })
    ).toBe("```\nplain\n```");
  });

  it("renders a prompt as heading + description + body", () => {
    expect(
      toMarkdown({
        title: "My Prompt",
        description: "does a thing",
        code: "Write a poem about {{topic}}.",
        language: "text",
        kind: "prompt",
      })
    ).toBe("# My Prompt\n\ndoes a thing\n\nWrite a poem about {{topic}}.");
  });

  it("omits an empty description for prompts", () => {
    expect(
      toMarkdown({
        title: "Bare",
        description: "   ",
        code: "body",
        language: "text",
        kind: "prompt",
      })
    ).toBe("# Bare\n\nbody");
  });
});

describe("libraryToMarkdown", () => {
  it("renders a titled document with a summary and rule-separated entries", () => {
    const doc = libraryToMarkdown(
      [
        {
          title: "Greeter",
          description: "says hi",
          code: "Say hi to {{name}}",
          language: "text",
          kind: "prompt",
          tags: ["social"],
        },
        {
          title: "Snippet",
          code: "const x = 1;",
          language: "javascript",
          kind: "code",
        },
      ],
      "2026-08-11"
    );
    expect(doc).toBe(
      "# SnipVault library\n\n" +
        "_2 entries · exported 2026-08-11_\n\n" +
        "---\n\n" +
        "## Greeter\n\n_#social_\n\nsays hi\n\nSay hi to {{name}}\n\n" +
        "---\n\n" +
        "## Snippet\n\n_javascript_\n\n```javascript\nconst x = 1;\n```"
    );
  });

  it("gives every entry a ## heading, including code snippets", () => {
    const doc = libraryToMarkdown([
      { title: "Only code", code: "echo hi", language: "bash", kind: "code" },
    ]);
    expect(doc).toContain("## Only code");
    expect(doc).toContain("```bash\necho hi\n```");
  });

  it("singularizes the summary and omits the date when not given", () => {
    const doc = libraryToMarkdown([
      { title: "One", code: "body", language: "text", kind: "prompt" },
    ]);
    expect(doc.startsWith("# SnipVault library\n\n_1 entry_\n\n---\n\n")).toBe(true);
  });
});
