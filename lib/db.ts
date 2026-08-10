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

  // Prompt history: an append-only log of prior versions, keyed by the snippet's
  // stable `uuid`. Each edit captures the pre-edit state here (see the PUT
  // route). Local to this database — not synced (append-only, no conflicts).
  conn.exec(`
    CREATE TABLE IF NOT EXISTS snippet_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snippet_uuid TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      code TEXT NOT NULL,
      language TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      model TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'prompt',
      saved_at TEXT NOT NULL,
      captured_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_revisions_uuid ON snippet_revisions(snippet_uuid, id);
  `);

  connection = conn;
  return connection;
}

// How many past revisions to keep per snippet (older ones pruned on capture).
export const REVISION_KEEP = 50;

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

// A past version of a snippet (prompt history). `saved_at` is the `updated_at`
// the version carried while it was live.
export type SnippetRevision = {
  id: number;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  model: string;
  kind: "prompt" | "code";
  saved_at: string;
};

function rowToRevision(row: Record<string, unknown>): SnippetRevision {
  return {
    id: Number(row.id),
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    code: (row.code as string) ?? "",
    language: (row.language as string) ?? "",
    tags: parseTags(row.tags),
    model: (row.model as string) ?? "",
    kind: row.kind === "code" ? "code" : "prompt",
    saved_at: (row.saved_at as string) ?? "",
  };
}

// Save the current state of a snippet as a revision before an edit overwrites
// it — unless the new values are identical (a no-op save shouldn't add history).
// Prunes to the newest REVISION_KEEP. `current` is the live row; `next` is the
// already-sanitized incoming values.
export function captureRevisionIfChanged(
  current: Record<string, unknown>,
  next: {
    title: string;
    description: string;
    code: string;
    language: string;
    tagsJson: string;
    model: string;
    kind: string;
  }
): void {
  const uuid = (current.uuid as string) ?? "";
  if (!uuid) return;
  const unchanged =
    ((current.title as string) ?? "") === next.title &&
    ((current.description as string) ?? "") === next.description &&
    ((current.code as string) ?? "") === next.code &&
    ((current.language as string) ?? "") === next.language &&
    ((current.tags as string) ?? "[]") === next.tagsJson &&
    ((current.model as string) ?? "") === next.model &&
    ((current.kind as string) ?? "prompt") === next.kind;
  if (unchanged) return;
  db.prepare(
    `INSERT INTO snippet_revisions
       (snippet_uuid, title, description, code, language, tags, model, kind, saved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuid,
    current.title,
    (current.description as string) ?? "",
    current.code,
    current.language,
    (current.tags as string) ?? "[]",
    (current.model as string) ?? "",
    (current.kind as string) ?? "prompt",
    (current.updated_at as string) ?? ""
  );
  db.prepare(
    `DELETE FROM snippet_revisions
     WHERE snippet_uuid = ?
       AND id NOT IN (
         SELECT id FROM snippet_revisions WHERE snippet_uuid = ? ORDER BY id DESC LIMIT ?
       )`
  ).run(uuid, uuid, REVISION_KEEP);
}

// Rename, merge, or delete a tag across the whole library. For every
// (non-deleted) snippet whose tags contain `from`, replace `from` with `to`
// (deduped, order preserved) — or drop it when `to` is null/empty (delete).
// Renaming onto a tag some rows already carry merges them. Only changed rows are
// rewritten, each with `updated_at` bumped so the change syncs (newest-wins).
// `from`/`to` are trimmed + lowercased to match the app's tag convention.
// Returns how many rows changed.
export function rewriteTag(fromRaw: string, toRaw: string | null): number {
  const from = fromRaw.trim().toLowerCase();
  if (!from) return 0;
  const to = toRaw == null ? null : toRaw.trim().toLowerCase() || null;
  if (to === from) return 0; // renaming to itself is a no-op

  const rows = db
    .prepare(`SELECT id, tags FROM snippets WHERE deleted = 0`)
    .all() as { id: number; tags: string }[];

  const update = db.prepare(
    `UPDATE snippets SET tags = ?, updated_at = datetime('now') WHERE id = ?`
  );

  const apply = db.transaction(() => {
    let changed = 0;
    for (const row of rows) {
      const tags = parseTags(row.tags);
      if (!tags.includes(from)) continue;
      const next: string[] = [];
      for (const t of tags) {
        const mapped = t === from ? to : t;
        if (mapped && !next.includes(mapped)) next.push(mapped);
      }
      const nextJson = JSON.stringify(next);
      if (nextJson === row.tags) continue;
      update.run(nextJson, row.id);
      changed++;
    }
    return changed;
  });
  return apply();
}

// Past versions of the snippet with the given autoincrement id, newest first.
export function getRevisionsForId(id: number): SnippetRevision[] {
  const rows = db
    .prepare(
      `SELECT r.* FROM snippet_revisions r
       JOIN snippets s ON s.uuid = r.snippet_uuid
       WHERE s.id = ?
       ORDER BY r.id DESC`
    )
    .all(id) as Record<string, unknown>[];
  return rows.map(rowToRevision);
}
