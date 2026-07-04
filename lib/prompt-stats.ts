// Lightweight, dependency-free stats for a prompt body.
//
// The token count is a rough estimate, not a real tokenizer: most English/code
// tokenizers average close to ~4 characters per token, so we use that as a
// good-enough guide for "will this fit in a context window?" without pulling in
// a model-specific tokenizer. It is intentionally labeled as approximate (~) in
// the UI.

export type PromptStats = {
  chars: number;
  words: number;
  tokens: number;
};

export function getPromptStats(text: string): PromptStats {
  // Count Unicode code points, not UTF-16 code units, so an astral character
  // (emoji, some CJK) counts as one character rather than two.
  const chars = [...text].length;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const tokens = Math.ceil(chars / 4);
  return { chars, words, tokens };
}

// Format a number with thousands separators (e.g. 1234 -> "1,234").
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
