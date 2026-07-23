// Snippet type definition (shared between frontend and backend)
export type Snippet = {
  id: number;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  favorite: boolean;
  model: string;
  copy_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateSnippetInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  tags?: string[];
  model?: string;
};

export type UpdateSnippetInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  tags?: string[];
  model?: string;
};

// Check if running in Tauri.
// __TAURI_INTERNALS__ is always injected by the Tauri v2 webview, unlike
// __TAURI__ which requires `app.withGlobalTauri: true` in tauri.conf.json.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Tauri invoke wrapper with type safety
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("Not running in Tauri");
  }
  // Dynamic import to avoid SSR issues
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// ---- Runtime mode ---------------------------------------------------------
//
// There are three ways snippet operations reach their data:
//   * web    — a browser: same-origin fetch to the Next.js API routes.
//   * local  — the desktop app with no server configured: Tauri `invoke` into
//              the bundled rusqlite database.
//   * remote — the desktop app pointed at a self-hosted sync server: HTTP calls
//              (via the Tauri HTTP plugin, so CSP/CORS don't apply) to that
//              server's API, carrying a bearer token.
//
// The remote config lives in the Rust-side config.json and is cached here after
// the first read so the hot path stays synchronous-ish.

export type RemoteConfig = { url: string; token: string };

let remoteConfig: RemoteConfig | null = null;
let remoteLoaded = false;

// Read (once) whether a sync server is configured. Only the desktop app can
// have one; in the browser this is always null.
async function loadRemoteConfig(): Promise<RemoteConfig | null> {
  if (!isTauri()) return null;
  if (remoteLoaded) return remoteConfig;
  try {
    remoteConfig = await invoke<RemoteConfig | null>("get_remote_config");
  } catch {
    remoteConfig = null;
  }
  remoteLoaded = true;
  return remoteConfig;
}

// The saved sync server, or null when in local/web mode. Public so the UI can
// show connection status.
export async function getRemoteConfig(): Promise<RemoteConfig | null> {
  return loadRemoteConfig();
}

// True when snippet operations should use the local rusqlite backend — i.e.
// running in Tauri with no sync server configured.
async function useLocalDb(): Promise<boolean> {
  if (!isTauri()) return false;
  return (await loadRemoteConfig()) === null;
}

// The Tauri HTTP plugin's fetch: same signature as the web fetch, but the
// request is made from Rust, bypassing the webview CSP and server CORS.
async function tauriHttpFetch(): Promise<typeof fetch> {
  const mod = await import("@tauri-apps/plugin-http");
  return mod.fetch as typeof fetch;
}

// Fetch against the active HTTP backend. In remote mode the path is resolved
// against the server URL and a bearer token is attached; in web mode it's a
// plain same-origin request. Not used in local (invoke) mode.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const remote = await loadRemoteConfig();
  if (remote) {
    const doFetch = await tauriHttpFetch();
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${remote.token}`);
    return doFetch(`${remote.url}${path}`, { ...init, headers });
  }
  return fetch(path, init);
}

// Throw a useful Error for a non-OK web response, preferring the server's own
// `{ error }` message so callers can surface it. Only consumes the body on
// failure, leaving res.json() available to the caller on success.
async function throwIfNotOk(res: Response, fallback: string): Promise<void> {
  if (res.ok) return;
  let message = fallback;
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    // No JSON body; keep the fallback message.
  }
  throw new Error(message);
}

// ---- Sync server connection (desktop only) --------------------------------

// Verify a sync server is reachable and the token is accepted, then save it and
// switch the app into remote mode. Throws a friendly message on failure so the
// caller can show it without saving a broken config.
export async function connectRemote(url: string, token: string): Promise<void> {
  const normalized = url.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("Enter a server URL.");

  let res: Response;
  try {
    const doFetch = await tauriHttpFetch();
    res = await doFetch(`${normalized}/api/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Error("Couldn't reach the server. Check the URL and that it's running.");
  }
  if (res.status === 401) throw new Error("Server rejected the token.");
  if (!res.ok) throw new Error(`Server error (HTTP ${res.status}).`);

  await invoke("set_remote_config", { url: normalized, token });
  remoteConfig = { url: normalized, token };
  remoteLoaded = true;
}

// Forget the sync server and return to the local database.
export async function disconnectRemote(): Promise<void> {
  await invoke("clear_remote_config");
  remoteConfig = null;
  remoteLoaded = true;
}

// API functions that work in browser, local desktop, and remote-server modes
export async function getSnippets(params?: {
  search?: string;
  language?: string;
  tag?: string;
  searchMode?: string;
}): Promise<Snippet[]> {
  if (await useLocalDb()) {
    return invoke<Snippet[]>("get_snippets", {
      search: params?.search || null,
      language: params?.language || null,
      tag: params?.tag || null,
      searchMode: params?.searchMode || null,
    });
  }

  const searchParams = new URLSearchParams();
  if (params?.search) {
    searchParams.set("search", params.search);
    if (params.searchMode) searchParams.set("searchMode", params.searchMode);
  }
  if (params?.language) searchParams.set("language", params.language);
  if (params?.tag) searchParams.set("tag", params.tag);

  const qs = searchParams.toString();
  const res = await apiFetch(`/api/snippets${qs ? `?${qs}` : ""}`);
  await throwIfNotOk(res, "Failed to fetch snippets");
  return res.json();
}

export async function createSnippet(input: CreateSnippetInput): Promise<Snippet> {
  if (await useLocalDb()) {
    return invoke<Snippet>("create_snippet", { input });
  }

  const res = await apiFetch("/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await throwIfNotOk(res, "Failed to create snippet");
  return res.json();
}

export async function updateSnippet(id: number, input: UpdateSnippetInput): Promise<Snippet | null> {
  if (await useLocalDb()) {
    return invoke<Snippet | null>("update_snippet", { id, input });
  }

  const res = await apiFetch(`/api/snippets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await throwIfNotOk(res, "Failed to update snippet");
  return res.json();
}

export async function deleteSnippet(id: number): Promise<boolean> {
  if (await useLocalDb()) {
    return invoke<boolean>("delete_snippet", { id });
  }

  const res = await apiFetch(`/api/snippets/${id}`, { method: "DELETE" });
  await throwIfNotOk(res, "Failed to delete snippet");
  return true;
}

// Pin/unpin a snippet so it floats to the top of the list.
export async function setFavorite(id: number, favorite: boolean): Promise<Snippet | null> {
  if (await useLocalDb()) {
    return invoke<Snippet | null>("set_favorite", { id, favorite });
  }

  const res = await apiFetch(`/api/snippets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorite }),
  });
  await throwIfNotOk(res, "Failed to update favorite");
  return res.json();
}

// Record that a snippet was copied (bumps its usage count). Fire-and-forget:
// failures are swallowed so a copy always succeeds even if tracking doesn't.
export async function recordCopy(id: number): Promise<Snippet | null> {
  try {
    if (await useLocalDb()) {
      return await invoke<Snippet | null>("record_copy", { id });
    }
    const res = await apiFetch(`/api/snippets/${id}/copy`, { method: "POST" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Re-insert a deleted snippet, preserving its fields. Backs undo-after-delete.
export async function restoreSnippet(snippet: Snippet): Promise<Snippet | null> {
  if (await useLocalDb()) {
    return invoke<Snippet | null>("restore_snippet", { snippet });
  }

  const res = await apiFetch(`/api/snippets/restore`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snippet),
  });
  await throwIfNotOk(res, "Failed to restore snippet");
  return res.json();
}

// ---- Database setup / management (desktop only) ---------------------------

export type InitStatus = {
  initialized: boolean;
  db_path: string | null;
};

// Whether first-run database setup is needed. In the browser there is nothing
// to set up (the web app always uses ./data/snippets.db), so report ready.
export async function getInitStatus(): Promise<InitStatus> {
  if (!isTauri()) return { initialized: true, db_path: null };
  return invoke<InitStatus>("get_init_status");
}

// Create a new database. Pass a path to place it somewhere specific, or omit
// to use the default app-data location.
export async function initializeNewDb(path?: string): Promise<string> {
  return invoke<string>("initialize_new_db", { path: path ?? null });
}

// Adopt an existing snippets.db the user already has.
export async function useExistingDb(path: string): Promise<string> {
  return invoke<string>("use_existing_db", { path });
}

export async function getDatabasePath(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("get_database_path");
}

// Write a copy of the current database to the given destination path.
export async function backupDatabase(destination: string): Promise<string> {
  return invoke<string>("backup_database", { destination });
}
