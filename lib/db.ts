import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "path";

// Base directory for on-disk data. Defaults to ./data under the current working
// directory (the Docker image mounts a volume there). SNIPVAULT_DATA_DIR
// relocates the whole tree — used by the multi-user test harness to run against
// a disposable directory.
const dataDir = process.env.SNIPVAULT_DATA_DIR
  ? path.resolve(process.env.SNIPVAULT_DATA_DIR)
  : path.join(process.cwd(), "data");

// The default (single-tenant) SQLite file. SNIPVAULT_DB_PATH overrides its exact
// location — used by the API test harness to run against a disposable database,
// and handy for self-hosters who want the file somewhere specific. This
// preserves the pre-multi-user layout exactly: ./data/snippets.db by default.
const defaultDbPath = process.env.SNIPVAULT_DB_PATH
  ? path.resolve(process.env.SNIPVAULT_DB_PATH)
  : path.join(dataDir, "snippets.db");

// Per-user vaults live under <dataDir>/users/<user>/snippets.db. Isolation is
// structural: each user gets a private SQLite file, so no query needs an
// `owner` filter and cross-user leakage is impossible by construction.
const usersRoot = path.join(dataDir, "users");

// User ids become path segments, so they're strictly validated — no traversal,
// no surprises. Mirrors the validation in proxy.ts.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Resolve the on-disk path for a user. `null`/"default" → the single-tenant
// default file (unchanged behaviour). Any other id is validated and mapped
// under the users root; the resolved path is then asserted to stay inside that
// root as a second guard against traversal.
export function dbPathForUser(user: string | null): string {
  if (user === null || user === "default") return defaultDbPath;
  if (!USER_ID_RE.test(user)) throw new Error("Invalid user id");
  const resolved = path.join(usersRoot, user, "snippets.db");
  const rootWithSep = usersRoot.endsWith(path.sep)
    ? usersRoot
    : usersRoot + path.sep;
  if (!resolved.startsWith(rootWithSep)) throw new Error("Invalid user path");
  return resolved;
}

// One open connection per resolved db path. better-sqlite3 handles are cheap, so
// for a homeserver's handful of users an unbounded cache is fine (an LRU is a
// later upgrade if a deployment ever grows large).
const connections = new Map<string, Database.Database>();

// Apply pragmas, schema, and migrations to a freshly opened connection. Every
// per-user file goes through the exact same path, so all vaults share one schema.
function initConnection(conn: Database.Database): void {
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
  // Per-prompt color tag ('' = none) for fast visual scanning. DEFAULT '' means
  // existing rows read as uncolored with no backfill pass.
  addColumn("color", "color TEXT NOT NULL DEFAULT ''");
  // Reusable-template flag; DEFAULT 0 backfills existing rows as non-templates.
  addColumn("template", "template INTEGER NOT NULL DEFAULT 0");
  // Device that last wrote the row ('' = unknown); stamped by the desktop app,
  // travels through sync. DEFAULT '' backfills existing rows.
  addColumn("last_device", "last_device TEXT NOT NULL DEFAULT ''");
  // Collection (folder) label ('' = none) for grouping the library, filtered
  // client-side. DEFAULT '' backfills existing rows.
  addColumn("collection", "collection TEXT NOT NULL DEFAULT ''");
  // Per-prompt icon (an emoji, '' = none). DEFAULT '' backfills existing rows.
  addColumn("icon", "icon TEXT NOT NULL DEFAULT ''");

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

  // Full-text search index over the searchable columns (title, description, tags,
  // model, and the body), kept in sync by triggers on the base table — so every
  // write path, including the sync merge, maintains it automatically. On first
  // creation it's built from any existing rows.
  const ftsExists = conn
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='snippets_fts'")
    .get();
  conn.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
      title, description, tags, model, code,
      content='snippets', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS snippets_fts_ai AFTER INSERT ON snippets BEGIN
      INSERT INTO snippets_fts(rowid, title, description, tags, model, code)
      VALUES (new.id, new.title, new.description, new.tags, new.model, new.code);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_fts_ad AFTER DELETE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, title, description, tags, model, code)
      VALUES('delete', old.id, old.title, old.description, old.tags, old.model, old.code);
    END;
    CREATE TRIGGER IF NOT EXISTS snippets_fts_au AFTER UPDATE ON snippets BEGIN
      INSERT INTO snippets_fts(snippets_fts, rowid, title, description, tags, model, code)
      VALUES('delete', old.id, old.title, old.description, old.tags, old.model, old.code);
      INSERT INTO snippets_fts(rowid, title, description, tags, model, code)
      VALUES (new.id, new.title, new.description, new.tags, new.model, new.code);
    END;
  `);
  if (!ftsExists) {
    conn.exec("INSERT INTO snippets_fts(snippets_fts) VALUES('rebuild')");
  }
}

// Open the database on first use rather than at import time. `next build`
// imports every API route module to collect page data; if a connection (with
// its WAL setup and schema migration) opened at import, several build workers
// would race to create the same fresh file and hit SQLITE_BUSY. Deferring to
// the first real query means a DB opens only when a request actually runs.
function openDbAt(dbPath: string): Database.Database {
  const cached = connections.get(dbPath);
  if (cached) return cached;

  // Ensure the parent directory exists. The default ./data is normally present,
  // but a custom path (or a per-user subdir on first use) may not be created
  // yet; better-sqlite3 would otherwise throw on open.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const conn = new Database(dbPath);
  initConnection(conn);
  connections.set(dbPath, conn);
  return conn;
}

// The connection for a given user (`null`/"default" → the single-tenant file).
export function getDbForUser(user: string | null): Database.Database {
  return openDbAt(dbPathForUser(user));
}

// The connection for a request, routed by the middleware-resolved user. The
// `x-snipvault-user` header is set (and any inbound copy stripped) by proxy.ts;
// a missing header means single-tenant / dev → the default file.
export function dbForRequest(req: Request): Database.Database {
  const user = req.headers.get("x-snipvault-user");
  return getDbForUser(user && user.length ? user : null);
}

// How many past revisions to keep per snippet (older ones pruned on capture).
export const REVISION_KEEP = 50;

// Lazy handle for the default vault: non-request code keeps using
// `db.prepare(...)` / `db.exec(...)` unchanged, but the underlying connection
// only opens on first property access. Request handlers use `dbForRequest`.
export const db: Database.Database = new Proxy({} as Database.Database, {
  get(_target, prop) {
    const real = getDbForUser(null);
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
  // Per-prompt color tag ("" = none). One of the fixed palette in
  // lib/prompt-colors.ts; validated on every write path.
  color: string;
  // Whether this entry is a reusable template (a starting point in the New
  // dialog). Metadata like favorite; not part of version history.
  template: boolean;
  // Friendly name of the device that last wrote this row ("" = unknown).
  last_device: string;
  // Collection (folder) this entry belongs to ("" = none). A single free-form
  // label used to group the library; filtered client-side.
  collection: string;
  // Short display icon (an emoji, "" = none) shown before the title.
  icon: string;
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
    color: (row.color as string) ?? "",
    template: Boolean(row.template),
    last_device: (row.last_device as string) ?? "",
    collection: (row.collection as string) ?? "",
    icon: (row.icon as string) ?? "",
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
  conn: Database.Database,
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
  conn.prepare(
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
  conn.prepare(
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
export function rewriteTag(
  conn: Database.Database,
  fromRaw: string,
  toRaw: string | null
): number {
  const from = fromRaw.trim().toLowerCase();
  if (!from) return 0;
  const to = toRaw == null ? null : toRaw.trim().toLowerCase() || null;
  if (to === from) return 0; // renaming to itself is a no-op

  const rows = conn
    .prepare(`SELECT id, tags FROM snippets WHERE deleted = 0`)
    .all() as { id: number; tags: string }[];

  const update = conn.prepare(
    `UPDATE snippets SET tags = ?, updated_at = datetime('now') WHERE id = ?`
  );

  const apply = conn.transaction(() => {
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
export function getRevisionsForId(
  conn: Database.Database,
  id: number
): SnippetRevision[] {
  const rows = conn
    .prepare(
      `SELECT r.* FROM snippet_revisions r
       JOIN snippets s ON s.uuid = r.snippet_uuid
       WHERE s.id = ?
       ORDER BY r.id DESC`
    )
    .all(id) as Record<string, unknown>[];
  return rows.map(rowToRevision);
}
