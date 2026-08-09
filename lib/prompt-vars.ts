// Prompt variables: `{{name}}` placeholders a user fills in when copying a
// prompt. Derived from the body at use time — there's no stored schema for them
// (stage 1), so this is a pure, dependency-free module shared by the fill dialog
// and the copy buttons. Names may contain word chars, dots, and hyphens
// (e.g. {{topic}}, {{user.name}}, {{tone-hint}}); surrounding whitespace inside
// the braces is ignored.

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

// The distinct variable names in a prompt body, in first-seen order.
export function extractVars(code: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of code.matchAll(VAR_RE)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

// Substitute each `{{name}}` with its value. A name with no provided value (or
// an empty one) is replaced with an empty string, so unfilled placeholders don't
// leak into the copied text. Text that doesn't match the placeholder shape is
// left untouched.
export function fillVars(code: string, values: Record<string, string>): string {
  return code.replace(VAR_RE, (_match, name: string) => values[name] ?? "");
}
