// Snippet type definition (shared between frontend and backend)
export type Snippet = {
  id: number;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type CreateSnippetInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  tags?: string[];
};

export type UpdateSnippetInput = {
  title: string;
  description?: string;
  code: string;
  language: string;
  tags?: string[];
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

// API functions that work in both browser and Tauri
export async function getSnippets(params?: {
  search?: string;
  language?: string;
  tag?: string;
  searchMode?: string;
}): Promise<Snippet[]> {
  if (isTauri()) {
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
  const res = await fetch(`/api/snippets${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch snippets");
  return res.json();
}

export async function createSnippet(input: CreateSnippetInput): Promise<Snippet> {
  if (isTauri()) {
    return invoke<Snippet>("create_snippet", { input });
  }

  const res = await fetch("/api/snippets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create snippet");
  return res.json();
}

export async function updateSnippet(id: number, input: UpdateSnippetInput): Promise<Snippet | null> {
  if (isTauri()) {
    return invoke<Snippet | null>("update_snippet", { id, input });
  }

  const res = await fetch(`/api/snippets/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return null;
  return res.json();
}

export async function deleteSnippet(id: number): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("delete_snippet", { id });
  }

  const res = await fetch(`/api/snippets/${id}`, { method: "DELETE" });
  return res.ok;
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
