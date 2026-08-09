import { describe, it, expect } from "vitest";
import { extractVars, fillVars } from "./prompt-vars";

describe("extractVars", () => {
  it("finds distinct names in first-seen order", () => {
    expect(extractVars("{{topic}} then {{tone}} then {{topic}}")).toEqual([
      "topic",
      "tone",
    ]);
  });
  it("tolerates whitespace inside the braces", () => {
    expect(extractVars("{{  topic  }}")).toEqual(["topic"]);
  });
  it("allows dots and hyphens in names", () => {
    expect(extractVars("{{user.name}} / {{tone-hint}}")).toEqual([
      "user.name",
      "tone-hint",
    ]);
  });
  it("returns nothing when there are no placeholders", () => {
    expect(extractVars("just some code with { braces }")).toEqual([]);
    expect(extractVars("")).toEqual([]);
  });
});

describe("fillVars", () => {
  it("substitutes provided values", () => {
    expect(fillVars("Write about {{topic}} in a {{tone}} tone", {
      topic: "otters",
      tone: "playful",
    })).toBe("Write about otters in a playful tone");
  });
  it("replaces missing or empty values with an empty string", () => {
    expect(fillVars("Hello {{name}}!", {})).toBe("Hello !");
    expect(fillVars("Hello {{name}}!", { name: "" })).toBe("Hello !");
  });
  it("replaces every occurrence of a repeated variable", () => {
    expect(fillVars("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });
  it("leaves non-placeholder text untouched", () => {
    expect(fillVars("no vars here", {})).toBe("no vars here");
  });
});
