// Suggested values for the optional "Model / target" field on a prompt.
// This is only a convenience list surfaced in a datalist — the field is
// free-text, so users can type any model or tool that isn't listed here.
export const MODEL_SUGGESTIONS = [
  "Claude Opus 4.8",
  "Claude Sonnet 5",
  "Claude Haiku 4.5",
  "GPT-4o",
  "GPT-4o mini",
  "GPT-4",
  "o1",
  "Gemini 2.0 Flash",
  "Gemini 1.5 Pro",
  "Llama 3.1",
  "Mistral Large",
  "DeepSeek",
  "Grok",
  "Midjourney",
  "Stable Diffusion",
  "DALL·E 3",
] as const;
