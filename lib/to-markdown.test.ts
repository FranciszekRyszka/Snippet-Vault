import { describe, expect, it } from "vitest";
import { toMarkdown } from "./to-markdown";

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
