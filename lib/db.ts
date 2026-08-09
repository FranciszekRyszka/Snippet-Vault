import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "path";

// The SQLite file location. Defaults to ./data/snippets.db under the current
// working directory (the Docker image mounts a volume there). Set
// SNIPVAULT_DB_PATH to relocate it — used by the API test harness to run
// against a disposable database, and handy for self-hosters who want the file
// somewhere specific.
const dbPath = process.env.SNIPVAULT_DB_PATH
  ? path.resolve(process.env.SNIPVAULT_DB_PATH)
  : path.join(process.cwd(), "data", "snippets.db");

let connection: Database.Database | null = null;

// Open the database on first use rather than at import time. `next build`
// imports every API route module to collect page data; if the connection (with
// its WAL setup and schema migration) opened at import, several build workers
// would race to create the same fresh file and hit SQLITE_BUSY. Deferring to
// the first real query means the DB opens only when a request actually runs.
function getDb(): Database.Database {
  if (connection) return connection;

  // Ensure the parent directory exists. The default ./data is normally present,
  // but a custom SNIPVAULT_DB_PATH (or a fresh checkout) may point somewhere
  // that isn't created yet; better-sqlite3 would otherwise throw on open.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const conn = new Database(dbPath);

  // Wait (rather than failing instantly) if another connection holds a write
  // lock — mirrors the desktop (rusqlite) backend's 5s timeout and keeps
  // overlapping requests on the sync server from erroring.
  conn.pragma("busy_timeout = 5000");

  // Enable WAL mode for better concurrency
  conn.pragma("journal_mode = WAL");

  // Initialize the database schema
  conn.exec(`
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
    (conn.prepare("PRAGMA table_info(snippets)").all() as { name: string }[]).map(
      (c) => c.name
    )
  );
  const addColumn = (name: string, definition: string) => {
    if (!existingColumns.has(name)) {
      conn.exec(`ALTER TABLE snippets ADD COLUMN ${definition}`);
      existingColumns.add(name);
    }
  };
  addColumn("favorite", "favorite INTEGER NOT NULL DEFAULT 0");
  addColumn("model", "model TEXT NOT NULL DEFAULT ''");
  addColumn("copy_count", "copy_count INTEGER NOT NULL DEFAULT 0");
  addColumn("last_used_at", "last_used_at TEXT");
  // Entry kind: 'prompt' (default) vs. 'code'. The DEFAULT backfills existing
  // rows, so no separate backfill pass is needed (unlike `uuid`).
  addColumn("kind", "kind TEXT NOT NULL DEFAULT 'prompt'");

  // Sync support: a stable cross-machine identity (`uuid`) and a soft-delete
  // tombstone (`deleted`). `uuid` is added nullable, backfilled for existing
  // rows, then made unique — SQLite can't ALTER-ADD a UNIQUE column directly.
  addColumn("uuid", "uuid TEXT");
  addColumn("deleted", "deleted INTEGER NOT NULL DEFAULT 0");
  const needUuid = conn
    .prepare("SELECT id FROM snippets WHERE uuid IS NULL OR uuid = ''")
    .all() as { id: number }[];
  if (needUuid.length) {
    const set = conn.prepare("UPDATE snippets SET uuid = ? WHERE id = ?");
    const backfill = conn.transaction((rows: { id: number }[]) => {
      for (const r of rows) set.run(randomUUID(), r.id);
    });
    backfill(needUuid);
  }
  conn.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_snippets_uuid ON snippets(uuid)"
  );

  connection = conn;
  return connection;
}

// Lazy handle: callers keep using `db.prepare(...)` / `db.exec(...)` unchanged,
// but the underlying connection only opens on first property access.
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export type Snippet = {
  id: number;
  uuid: string;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  favorite: boolean;
  model: string;
  kind: "prompt" | "code";
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
    uuid: (row.uuid as string) ?? "",
    tags: parseTags(row.tags),
    favorite: Boolean(row.favorite),
    model: (row.model as string) ?? "",
    kind: row.kind === "code" ? "code" : "prompt",
    copy_count: Number(row.copy_count ?? 0),
    last_used_at: (row.last_used_at as string) ?? null,
  } as Snippet;
}
