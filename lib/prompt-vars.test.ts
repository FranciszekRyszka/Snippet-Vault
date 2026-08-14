import { describe, it, expect } from "vitest";
import {
  extractVars,
  fillVars,
  parseVars,
  segmentByVars,
} from "./prompt-vars";

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
  it("falls back to a variable's default when unfilled", () => {
    expect(fillVars("Hi {{name=friend}}", {})).toBe("Hi friend");
    expect(fillVars("Hi {{name=friend}}", { name: "Sam" })).toBe("Hi Sam");
  });
  it("uses one variable's default for all its occurrences, even bare ones", () => {
    // The typed/default occurrence and a later plain {{topic}} resolve the same.
    expect(fillVars("{{topic=AI}} … more {{topic}}", {})).toBe("AI … more AI");
  });
  it("strips the type/options syntax when substituting", () => {
    expect(fillVars("Tone: {{tone:select(formal,playful)=formal}}", {})).toBe(
      "Tone: formal"
    );
    expect(
      fillVars("Tone: {{tone:select(formal,playful)}}", { tone: "playful" })
    ).toBe("Tone: playful");
  });
  it("strips a hint when substituting (default or provided)", () => {
    expect(fillVars("Hi {{name=friend|the reader}}", {})).toBe("Hi friend");
    expect(fillVars("Hi {{name|the reader}}", { name: "Sam" })).toBe("Hi Sam");
  });
});

describe("parseVars", () => {
  it("parses a plain variable as text with no default", () => {
    expect(parseVars("{{topic}}")).toEqual([
      { name: "topic", type: "text", options: [], default: "", hint: "" },
    ]);
  });
  it("parses a default value", () => {
    expect(parseVars("{{topic=AI safety}}")).toEqual([
      { name: "topic", type: "text", options: [], default: "AI safety", hint: "" },
    ]);
  });
  it("parses select options and a default choice", () => {
    expect(parseVars("{{tone:select(formal, playful, concise)=formal}}")).toEqual([
      {
        name: "tone",
        type: "select",
        options: ["formal", "playful", "concise"],
        default: "formal",
        hint: "",
      },
    ]);
  });
  it("parses multiline, number, and date types", () => {
    expect(parseVars("{{notes:multiline}}")[0].type).toBe("multiline");
    expect(parseVars("{{count:number=3}}")).toEqual([
      { name: "count", type: "number", options: [], default: "3", hint: "" },
    ]);
    expect(parseVars("{{when:date}}")[0].type).toBe("date");
  });
  it("degrades an unknown type — or an empty select — to text", () => {
    expect(parseVars("{{x:bogus}}")[0].type).toBe("text");
    expect(parseVars("{{x:select()}}")[0].type).toBe("text");
  });
  it("keeps the first occurrence's spec for a repeated name", () => {
    expect(parseVars("{{tone:select(a,b)=a}} … {{tone}}")).toEqual([
      { name: "tone", type: "select", options: ["a", "b"], default: "a", hint: "" },
    ]);
  });
  it("parses a hint, alone and alongside a default", () => {
    expect(parseVars("{{topic|what to write about}}")).toEqual([
      { name: "topic", type: "text", options: [], default: "", hint: "what to write about" },
    ]);
    expect(parseVars("{{tone=formal|how it should read}}")).toEqual([
      { name: "tone", type: "text", options: [], default: "formal", hint: "how it should read" },
    ]);
  });
  it("keeps a hint out of the default (default stops at the pipe)", () => {
    const spec = parseVars("{{name=Sam|the reader's name}}")[0];
    expect(spec.default).toBe("Sam");
    expect(spec.hint).toBe("the reader's name");
  });
  it("supports a hint on a typed variable", () => {
    expect(parseVars("{{tone:select(a,b)=a|pick a tone}}")).toEqual([
      { name: "tone", type: "select", options: ["a", "b"], default: "a", hint: "pick a tone" },
    ]);
  });
});

describe("segmentByVars", () => {
  it("splits text into plain and placeholder runs", () => {
    expect(segmentByVars("a {{x}} b")).toEqual([
      { text: "a ", isVar: false },
      { text: "{{x}}", isVar: true },
      { text: " b", isVar: false },
    ]);
  });
  it("treats a typed/default placeholder as a single highlighted run", () => {
    expect(segmentByVars("{{tone:select(a,b)=a}}")).toEqual([
      { text: "{{tone:select(a,b)=a}}", isVar: true },
    ]);
  });
  it("returns a single plain run when there are no placeholders", () => {
    expect(segmentByVars("nothing here")).toEqual([
      { text: "nothing here", isVar: false },
    ]);
  });
});
