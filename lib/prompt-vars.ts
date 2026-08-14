// Prompt variables: `{{name}}` placeholders a user fills in when copying a
// prompt. Derived from the body at use time — there's no stored schema, so this
// is a pure, dependency-free module shared by the fill dialog, the copy buttons,
// and the live-highlight body renderer.
//
// The placeholder grammar is backward-compatible — a plain `{{name}}` behaves
// exactly as before — and optionally carries a **type**, a **default**, and a
// **hint** (help text shown under the field in the fill dialog):
//
//   {{ name [ :type[(opts)] ] [ =default ] [ |hint ] }}
//
//   {{topic}}                        text, no default
//   {{topic=AI safety}}              text with a default value
//   {{tone:select(formal,playful)}}  a dropdown of choices
//   {{tone:select(a,b)=a}}           a dropdown with a default choice
//   {{notes:multiline}}              a multi-line textarea
//   {{count:number=3}}               a number field with a default
//   {{when:date}}                    a date field
//   {{topic|what to write about}}    a hint under the field
//   {{tone=formal|how it should read}}  a default *and* a hint
//
// Names may contain word chars, dots, and hyphens (e.g. {{user.name}}); an
// unknown type falls back to plain text, so a stray `:something` never breaks a
// prompt. A `|` starts the hint, so a default value can't itself contain `|`.

export type VarType = "text" | "multiline" | "number" | "date" | "select";

// One parsed variable. `name` is the stable key used for values and storage;
// `options` is only meaningful for `select`; `default` is "" when none is given;
// `hint` is optional help text shown under the field ("" when none).
export type VarSpec = {
  name: string;
  type: VarType;
  options: string[];
  default: string;
  hint: string;
};

// One run of body text, flagged as a placeholder or plain text, for the
// highlight renderer (keeps the placeholder-matching regex in one place).
export type VarSegment = { text: string; isVar: boolean };

// name  :  type  ( opts )   =  default   |  hint
// The default excludes `|` so a trailing `|hint` isn't swallowed into it.
const VAR_PATTERN =
  String.raw`\{\{\s*([\w.-]+)\s*(?::\s*([a-zA-Z]+)\s*(?:\(([^)]*)\))?\s*)?(?:=([^}|]*))?(?:\|([^}]*))?\}\}`;

// A fresh global regex per call — these helpers aren't hot paths, and it keeps
// the shared `lastIndex` state from leaking between matchAll / replace uses.
function varRe(): RegExp {
  return new RegExp(VAR_PATTERN, "g");
}

// Resolve the type word (+ select options) into a normalized spec fragment.
// Anything unrecognized — or a `select` with no options — degrades to text.
function normalizeType(
  word: string | undefined,
  opts: string | undefined
): { type: VarType; options: string[] } {
  switch ((word ?? "").toLowerCase()) {
    case "select": {
      const options = (opts ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      return options.length ? { type: "select", options } : { type: "text", options: [] };
    }
    case "multiline":
    case "textarea":
      return { type: "multiline", options: [] };
    case "number":
      return { type: "number", options: [] };
    case "date":
      return { type: "date", options: [] };
    default:
      return { type: "text", options: [] };
  }
}

// The distinct variables in a prompt body, in first-seen order. When a name
// appears more than once, its **first** occurrence defines the type/default
// (later bare `{{name}}` uses reuse the same spec).
export function parseVars(code: string): VarSpec[] {
  const seen = new Map<string, VarSpec>();
  for (const m of code.matchAll(varRe())) {
    const name = m[1];
    if (seen.has(name)) continue;
    const { type, options } = normalizeType(m[2], m[3]);
    seen.set(name, {
      name,
      type,
      options,
      default: (m[4] ?? "").trim(),
      hint: (m[5] ?? "").trim(),
    });
  }
  return [...seen.values()];
}

// The distinct variable names in a prompt body, in first-seen order.
// Backward-compatible with the stage-1 API (callers that only need the names).
export function extractVars(code: string): string[] {
  return parseVars(code).map((v) => v.name);
}

// Substitute each `{{...}}` with its value. A name with no provided (or empty)
// value falls back to that variable's **default**, then to an empty string — so
// every occurrence of a name resolves consistently and unfilled placeholders
// don't leak into the copied text. Text that doesn't match is left untouched.
export function fillVars(code: string, values: Record<string, string>): string {
  const specs = new Map(parseVars(code).map((v) => [v.name, v]));
  return code.replace(varRe(), (_match, name: string) => {
    const provided = values[name];
    if (provided !== undefined && provided !== "") return provided;
    return specs.get(name)?.default ?? "";
  });
}

// Split a body into alternating plain-text / placeholder segments, so the
// highlight renderer can wrap placeholders without re-deriving the regex.
export function segmentByVars(code: string): VarSegment[] {
  const out: VarSegment[] = [];
  let last = 0;
  for (const m of code.matchAll(varRe())) {
    const start = m.index ?? 0;
    if (start > last) out.push({ text: code.slice(last, start), isVar: false });
    out.push({ text: m[0], isVar: true });
    last = start + m[0].length;
  }
  if (last < code.length) out.push({ text: code.slice(last), isVar: false });
  return out;
}
