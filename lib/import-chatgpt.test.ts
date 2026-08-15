import { describe, it, expect } from "vitest";
import { isChatGPTExport, parseChatGPTExport } from "./import-chatgpt";

// A minimal conversations.json-shaped fixture: one conversation with a user
// message and an assistant reply.
function convo(
  title: string,
  userText: string,
  opts: { assistant?: string; extraUser?: { text: string; time: number } } = {}
) {
  const mapping: Record<string, unknown> = {
    root: { id: "root", message: null, parent: null, children: ["u1"] },
    u1: {
      id: "u1",
      message: {
        author: { role: "user" },
        create_time: 100,
        content: { content_type: "text", parts: [userText] },
      },
      parent: "root",
      children: ["a1"],
    },
    a1: {
      id: "a1",
      message: {
        author: { role: "assistant" },
        create_time: 101,
        content: { content_type: "text", parts: [opts.assistant ?? "Sure!"] },
      },
      parent: "u1",
      children: [],
    },
  };
  if (opts.extraUser) {
    mapping.u2 = {
      id: "u2",
      message: {
        author: { role: "user" },
        create_time: opts.extraUser.time,
        content: { content_type: "text", parts: [opts.extraUser.text] },
      },
      parent: "a1",
      children: [],
    };
  }
  return { title, create_time: 100, update_time: 200, mapping };
}

describe("isChatGPTExport", () => {
  it("recognizes an array of conversations with a mapping", () => {
    expect(isChatGPTExport([convo("Poem", "Write a poem")])).toBe(true);
  });

  it("rejects a plain prompt-export array (no mapping)", () => {
    expect(isChatGPTExport([{ title: "x", code: "y" }])).toBe(false);
  });

  it("rejects non-arrays and empty arrays", () => {
    expect(isChatGPTExport({})).toBe(false);
    expect(isChatGPTExport([])).toBe(false);
    expect(isChatGPTExport(null)).toBe(false);
  });
});

describe("parseChatGPTExport", () => {
  it("uses the title and the first user message as the body", () => {
    const out = parseChatGPTExport([convo("My poem chat", "Write a poem about the sea")]);
    expect(out).toEqual([
      { title: "My poem chat", body: "Write a poem about the sea" },
    ]);
  });

  it("takes the earliest user message by timestamp, not key order", () => {
    // extraUser is earlier (time 50) than u1 (time 100) — it should win.
    const out = parseChatGPTExport([
      convo("Chat", "second message", { extraUser: { text: "first message", time: 50 } }),
    ]);
    expect(out[0].body).toBe("first message");
  });

  it("derives a title from the body when the conversation has none", () => {
    const out = parseChatGPTExport([convo("", "Summarize this article for me")]);
    expect(out[0].title).toBe("Summarize this article for me");
  });

  it("skips conversations with no user text (assistant-only / empty)", () => {
    const empty = {
      title: "Empty",
      mapping: {
        a1: {
          message: {
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["hi"] },
          },
        },
      },
    };
    expect(parseChatGPTExport([empty])).toEqual([]);
  });

  it("ignores non-string parts (multimodal images) but keeps text", () => {
    const multimodal = {
      title: "Image chat",
      mapping: {
        u1: {
          message: {
            author: { role: "user" },
            create_time: 10,
            content: {
              content_type: "multimodal_text",
              parts: [{ asset_pointer: "file-x" }, "Describe this picture"],
            },
          },
        },
      },
    };
    const out = parseChatGPTExport([multimodal]);
    expect(out).toEqual([{ title: "Image chat", body: "Describe this picture" }]);
  });

  it("returns [] for malformed input without throwing", () => {
    expect(parseChatGPTExport(null)).toEqual([]);
    expect(parseChatGPTExport("nope")).toEqual([]);
    expect(parseChatGPTExport([null, 5, "x"])).toEqual([]);
  });
});
