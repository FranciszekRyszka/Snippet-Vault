import { describe, it, expect } from "vitest";
import { isClaudeExport, parseClaudeExport } from "./import-claude";

function convo(name: string, messages: Record<string, unknown>[]) {
  return { uuid: "u1", name, created_at: "2026-01-01", chat_messages: messages };
}

describe("isClaudeExport", () => {
  it("recognizes an array of conversations with chat_messages", () => {
    expect(isClaudeExport([convo("Chat", [])])).toBe(true);
  });
  it("rejects a ChatGPT-shaped export (mapping, no chat_messages)", () => {
    expect(isClaudeExport([{ title: "x", mapping: {} }])).toBe(false);
  });
  it("rejects non-arrays and empty arrays", () => {
    expect(isClaudeExport({})).toBe(false);
    expect(isClaudeExport([])).toBe(false);
  });
});

describe("parseClaudeExport", () => {
  it("uses the name and the first human message (flat text)", () => {
    const out = parseClaudeExport([
      convo("Poem chat", [
        { sender: "human", text: "Write a poem about rain" },
        { sender: "assistant", text: "Sure!" },
      ]),
    ]);
    expect(out).toEqual([{ title: "Poem chat", body: "Write a poem about rain" }]);
  });

  it("reads structured content parts when there is no flat text", () => {
    const out = parseClaudeExport([
      convo("Structured", [
        { sender: "human", content: [{ type: "text", text: "Explain closures" }] },
      ]),
    ]);
    expect(out[0].body).toBe("Explain closures");
  });

  it("derives a title from the body when the name is empty", () => {
    const out = parseClaudeExport([
      convo("", [{ sender: "human", text: "Summarize this for me" }]),
    ]);
    expect(out[0].title).toBe("Summarize this for me");
  });

  it("skips conversations with no human message", () => {
    const out = parseClaudeExport([
      convo("Assistant only", [{ sender: "assistant", text: "hello" }]),
    ]);
    expect(out).toEqual([]);
  });

  it("returns [] for malformed input", () => {
    expect(parseClaudeExport(null)).toEqual([]);
    expect(parseClaudeExport([null, 3])).toEqual([]);
  });
});
