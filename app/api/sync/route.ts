import { dbForRequest, captureRevisionIfChanged } from "@/lib/db";
import { NextResponse } from "next/server";
import {
  sanitizeTags,
  sanitizeModel,
  sanitizeKind,
  sanitizeColor,
  sanitizeCollection,
  sanitizeIcon,
  sanitizeDevice,
  validTimestampOr,
} from "@/lib/api-utils";

// Resource ceilings for a sync push. App Router route handlers don't inherit the
// old Pages-API body-size limit, so without these a single request could buffer
// an unbounded body into memory and bloat the SQLite file. The limits are far
// above any realistic library so honest clients never hit them.
const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB whole-request cap
const MAX_RECORDS = 100_000; // per-request record count
const MAX_CODE_LEN = 500_000; // per-snippet code/body length
const MAX_DESC_LEN = 100_000; // per-snippet description length

// One record as it travels over the wire between a client and the sync server.
// It's the full snippet shape keyed by `uuid` (the stable cross-machine
// identity), plus the `deleted` tombstone flag — everything needed to
// reconcile, including hidden (deleted) rows.
type SyncRecord = {
  uuid: string;
  title: string;
  description: string;
  code: string;
  language: string;
  tags: string[];
  favorite: boolean;
  model: string;
  kind: "prompt" | "code";
  color: string;
  template: boolean;
  last_device: string;
  collection: string;
  icon: string;
  copy_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  deleted: boolean;
};

// Map a database row into a wire record (tags → array, flags → booleans).
function rowToRecord(row: Record<string, unknown>): SyncRecord {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse((row.tags as string) ?? "[]");
    if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === "string");
  } catch {
    tags = [];
  }
  return {
    uuid: (row.uuid as string) ?? "",
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    code: (row.code as string) ?? "",
    language: (row.language as string) ?? "",
    tags,
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
    created_at: (row.created_at as string) ?? "",
    updated_at: (row.updated_at as string) ?? "",
    deleted: Boolean(row.deleted),
  };
}

// Coerce an untrusted incoming record into safe, storable values. Returns null
// if it can't be used (no uuid, or no title/code — the only hard requirements).
// Unlike the create route we don't reject unknown languages: a peer on a newer
// app version may legitimately have languages this server doesn't know yet, and
// dropping the user's prompt would be worse than storing it.
function normalizeIncoming(raw: unknown): {
  uuid: string;
  title: string;
  description: string;
  code: string;
  language: string;
  tagsJson: string;
  favorite: number;
  model: string;
  kind: "prompt" | "code";
  color: string;
  template: number;
  lastDevice: string;
  collection: string;
  icon: string;
  copyCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deleted: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const uuid = typeof r.uuid === "string" ? r.uuid.trim() : "";
  const title = typeof r.title === "string" ? r.title : "";
  const code = typeof r.code === "string" ? r.code : "";
  if (!uuid || !title || !code) return null;

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const copyCountRaw = r.copy_count;
  const copyCount =
    typeof copyCountRaw === "number" && Number.isFinite(copyCountRaw)
      ? Math.max(0, Math.floor(copyCountRaw))
      : 0;

  return {
    uuid,
    title: title.slice(0, 255),
    description:
      typeof r.description === "string"
        ? r.description.slice(0, MAX_DESC_LEN)
        : "",
    code: code.slice(0, MAX_CODE_LEN),
    language: typeof r.language === "string" ? r.language : "text",
    tagsJson: JSON.stringify(sanitizeTags(r.tags)),
    favorite: r.favorite === true ? 1 : 0,
    model: sanitizeModel(r.model),
    kind: sanitizeKind(r.kind),
    color: sanitizeColor(r.color),
    template: r.template === true ? 1 : 0,
    lastDevice: sanitizeDevice(r.last_device),
    collection: sanitizeCollection(r.collection),
    icon: sanitizeIcon(r.icon),
    copyCount,
    lastUsedAt: validTimestampOr(r.last_used_at, null),
    createdAt: validTimestampOr(r.created_at, now) ?? now,
    updatedAt: validTimestampOr(r.updated_at, now) ?? now,
    deleted: r.deleted === true ? 1 : 0,
  };
}

// Bidirectional sync in one round trip:
//   1. The client POSTs its full record set (including its own tombstones).
//   2. We merge each into our database by uuid, newest `updated_at` winning.
//   3. We return our full, now-merged set so the client can apply the same
//      newest-wins rule locally.
// Both sides converge to the union of records with the most recent edits.
export async function POST(request: Request) {
  const db = dbForRequest(request);
  try {
    // Reject oversized pushes before buffering/parsing. Trust the declared
    // Content-Length for a fast early-out, then re-check the actual bytes (a
    // client can lie about or omit the header) before touching JSON.parse.
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }

    const body = JSON.parse(raw);
    const incoming: unknown[] = Array.isArray(body?.records) ? body.records : [];
    if (incoming.length > MAX_RECORDS) {
      return NextResponse.json(
        { error: "Too many records in one sync" },
        { status: 413 }
      );
    }

    const findStmt = db.prepare("SELECT * FROM snippets WHERE uuid = ?");
    const insertStmt = db.prepare(`
      INSERT INTO snippets (uuid, title, description, code, language, tags, favorite, model, kind, color, template, last_device, collection, icon, copy_count, last_used_at, created_at, updated_at, deleted)
      VALUES (@uuid, @title, @description, @code, @language, @tagsJson, @favorite, @model, @kind, @color, @template, @lastDevice, @collection, @icon, @copyCount, @lastUsedAt, @createdAt, @updatedAt, @deleted)
    `);
    const updateStmt = db.prepare(`
      UPDATE snippets
      SET title = @title, description = @description, code = @code, language = @language,
          tags = @tagsJson, favorite = @favorite, model = @model, kind = @kind, color = @color, template = @template, last_device = @lastDevice, collection = @collection, icon = @icon, copy_count = @copyCount,
          last_used_at = @lastUsedAt, created_at = @createdAt, updated_at = @updatedAt, deleted = @deleted
      WHERE uuid = @uuid
    `);

    let applied = 0;
    let conflicts = 0;
    const merge = db.transaction((records: unknown[]) => {
      for (const raw of records) {
        const rec = normalizeIncoming(raw);
        if (!rec) continue;
        const existing = findStmt.get(rec.uuid) as
          | Record<string, unknown>
          | undefined;
        if (!existing) {
          insertStmt.run(rec);
          applied++;
        } else if (rec.updatedAt > (existing.updated_at as string)) {
          // Fixed-width UTC timestamps ("YYYY-MM-DD HH:MM:SS") compare correctly
          // as strings, so this is a true "most recent edit wins". Before the
          // overwrite, if the stored content diverged from the incoming edit,
          // preserve the local version in history (so newest-wins never silently
          // drops a real conflicting edit) and count it as a conflict.
          const differs =
            (existing.title as string) !== rec.title ||
            (existing.description as string) !== rec.description ||
            (existing.code as string) !== rec.code ||
            (existing.language as string) !== rec.language ||
            (existing.tags as string) !== rec.tagsJson ||
            (existing.model as string) !== rec.model ||
            (existing.kind as string) !== rec.kind;
          if (differs) {
            captureRevisionIfChanged(db, existing, {
              title: rec.title,
              description: rec.description,
              code: rec.code,
              language: rec.language,
              tagsJson: rec.tagsJson,
              model: rec.model,
              kind: rec.kind,
            });
            conflicts++;
          }
          updateStmt.run(rec);
          applied++;
        }
      }
    });
    merge(incoming);

    const rows = db
      .prepare("SELECT * FROM snippets")
      .all() as Record<string, unknown>[];
    const records = rows.map(rowToRecord);

    return NextResponse.json({ records, applied, conflicts });
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
