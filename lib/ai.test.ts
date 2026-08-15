import { describe, it, expect } from "vitest";
import { buildChatBody, parseChatResponse } from "./ai";

describe("buildChatBody", () => {
  it("builds an OpenAI-compatible request with system + user messages", () => {
    const body = buildChatBody("gpt-4o-mini", "be helpful", "hi there");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: "hi there" },
    ]);
    expect(typeof body.temperature).toBe("number");
  });
});

describe("parseChatResponse", () => {
  it("extracts the assistant message content", () => {
    const json = { choices: [{ message: { role: "assistant", content: "  hello  " } }] };
    expect(parseChatResponse(json)).toBe("hello");
  });

  it("surfaces the provider's error message", () => {
    expect(() =>
      parseChatResponse({ error: { message: "Invalid API key" } })
    ).toThrow("Invalid API key");
  });

  it("throws on an empty/malformed response", () => {
    expect(() => parseChatResponse({})).toThrow();
    expect(() => parseChatResponse({ choices: [] })).toThrow();
    expect(() =>
      parseChatResponse({ choices: [{ message: { content: "" } }] })
    ).toThrow();
  });
});
