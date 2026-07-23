import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "snippets.db");
const db = new Database(dbPath);

// Wait (rather than failing instantly) if another connection holds a write
// lock. Without this, concurrent opens — e.g. Next.js evaluating several API
// route modules in parallel during a build, or overlapping requests on the
// sync server — can hit SQLITE_BUSY while the schema is being set up. Mirrors
// the desktop (rusqlite) backend, which sets the same 5s timeout.
db.pragma("busy_timeout = 5000");

// Enable WAL mode for better concurrency
db.pragma("journal_mode = WAL");

// Initialize the database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    code TEXT NOT NULL,
    language TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets(language);
  CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets(created_at);
`);

// Migrations: add columns introduced after the initial schema to older
// databases. Each is guarded so it runs at most once.
const existingColumns = new Set(
  (db.prepare("PRAGMA table_info(snippets)").all() as { name: string }[]).map(
    (c) => c.name
  )
);
const addColumn = (name: string, definition: string) => {
  if (!existingColumns.has(name)) {
    db.exec(`ALTER TABLE snippets ADD COLUMN ${definition}`);
    existingColumns.add(name);
  }
};
addColumn("favorite", "favorite INTEGER NOT NULL DEFAULT 0");
addColumn("model", "model TEXT NOT NULL DEFAULT ''");
addColumn("copy_count", "copy_count INTEGER NOT NULL DEFAULT 0");
addColumn("last_used_at", "last_used_at TEXT");

export { db };

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

// Parse the stored JSON tags array, tolerating a corrupt/malformed cell rather
// than throwing — one bad row must not 500 the entire list.
function parseTags(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

// Helper to convert DB row (with JSON tags) to Snippet type
export function rowToSnippet(row: Record<string, unknown>): Snippet {
  return {
    ...row,
    tags: parseTags(row.tags),
    favorite: Boolean(row.favorite),
    model: (row.model as string) ?? "",
    copy_count: Number(row.copy_count ?? 0),
    last_used_at: (row.last_used_at as string) ?? null,
  } as Snippet;
}
