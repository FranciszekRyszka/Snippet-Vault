// Optional, opt-in AI assistant (bring-your-own-key). Desktop-only: the call
// goes out through the Tauri HTTP plugin (which bypasses browser CORS) to an
// OpenAI-compatible chat-completions endpoint the user configures, so it also
// works with local servers (Ollama/LM Studio) or a proxy by changing the base
// URL. The API key lives in the OS keyring (see src-tauri/src/lib.rs); it's read
// into memory only for the duration of a call.
//
// Privacy: using this sends the prompt text you act on to the configured
// provider. It's entirely opt-in and off until you add a key in Settings.

import { isTauri } from "./tauri-api";

export type AiSettings = { base_url: string; model: string; has_key: boolean };

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// Current AI settings (endpoint + model + whether a key is set). On the web there
// is no assistant, so report unconfigured.
export async function getAiSettings(): Promise<AiSettings> {
  if (!isTauri()) return { base_url: "", model: "", has_key: false };
  return invoke<AiSettings>("get_ai_settings");
}

// Save endpoint/model; pass `apiKey` to set it (empty string clears it), or
// undefined to leave the stored key unchanged.
export async function setAiSettings(
  baseUrl: string,
  model: string,
  apiKey?: string
): Promise<void> {
  await invoke("set_ai_settings", {
    baseUrl,
    model,
    apiKey: apiKey ?? null,
  });
}

// Whether the assistant is usable right now (desktop + a key is configured).
export async function isAiConfigured(): Promise<boolean> {
  const s = await getAiSettings();
  return s.has_key;
}

// ---- Pure helpers (unit-tested) -------------------------------------------

// Build an OpenAI-compatible chat-completions request body.
export function buildChatBody(model: string, system: string, user: string) {
  return {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
  };
}

// Extract the assistant's text from an OpenAI-compatible response, tolerating
// minor shape differences. Throws a friendly error if the response carries one,
// or if no content can be found.
export function parseChatResponse(json: unknown): string {
  const j = json as Record<string, unknown>;
  if (j && typeof j === "object" && j.error) {
    const err = j.error as Record<string, unknown>;
    const msg =
      err && typeof err.message === "string" ? err.message : "The AI provider returned an error.";
    throw new Error(msg);
  }
  const choices = (j?.choices as unknown[]) ?? [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  throw new Error("The AI provider returned an empty response.");
}

// ---- The call --------------------------------------------------------------

// Run a single system+user completion and return the assistant's text. Desktop
// only; throws a friendly message when unavailable or on any transport/API error.
export async function aiComplete(system: string, user: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("The AI assistant is only available in the desktop app.");
  }
  const settings = await getAiSettings();
  if (!settings.has_key) {
    throw new Error("Add an AI provider key in Settings → AI assistant first.");
  }
  const key = await invoke<string>("get_ai_key");
  if (!key) {
    throw new Error("No AI key is configured.");
  }

  const url = `${settings.base_url.replace(/\/+$/, "")}/chat/completions`;
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");

  let res: Response;
  try {
    res = await tauriFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(buildChatBody(settings.model, system, user)),
    });
  } catch {
    throw new Error("Couldn't reach the AI provider. Check the endpoint URL.");
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    if (!res.ok) throw new Error(`AI provider error (HTTP ${res.status}).`);
    throw new Error("The AI provider returned an unreadable response.");
  }
  if (!res.ok) {
    // Prefer the provider's own error message when present.
    try {
      return parseChatResponse(json);
    } catch (e) {
      throw e instanceof Error ? e : new Error(`AI provider error (HTTP ${res.status}).`);
    }
  }
  return parseChatResponse(json);
}

// ---- Task prompts ----------------------------------------------------------

// "Improve this prompt": returns a rewritten, clearer version of the body.
export async function improvePrompt(body: string): Promise<string> {
  return aiComplete(
    "You are an expert prompt engineer. Rewrite the user's prompt to be clearer, " +
      "more specific, and more effective, preserving its intent and any " +
      "{{variable}} placeholders exactly. Return ONLY the improved prompt text, " +
      "with no preamble or explanation.",
    body
  );
}

// "Suggest a title": a short, descriptive title for the prompt.
export async function suggestTitle(body: string): Promise<string> {
  const raw = await aiComplete(
    "Suggest a concise, descriptive title (3–7 words, no quotes, no trailing " +
      "punctuation) for the following prompt. Return ONLY the title.",
    body
  );
  return raw.replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 255);
}

// "Suggest tags": a few lowercase tags for the prompt.
export async function suggestTags(body: string): Promise<string[]> {
  const raw = await aiComplete(
    "Suggest 3–6 short, lowercase, single-word tags for the following prompt, " +
      "as a comma-separated list. Return ONLY the list.",
    body
  );
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean)
    .slice(0, 6);
}
