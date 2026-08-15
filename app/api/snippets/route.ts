import { dbForRequest, rowToSnippet, type Snippet } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";
import { escapeLike, sanitizeTags, sanitizeModel, sanitizeKind, sanitizeColor, sanitizeCollection, sanitizeIcon, ftsMatchQuery } from "@/lib/api-utils";

const validLanguages = LANGUAGES.map((l) => l.value);

// Sort key → a fixed ORDER BY fragment. Pinned (favorite) rows always lead so
// pins stay on top in every mode. Keyed lookup (never interpolate the raw param)
// keeps this injection-safe; an unknown key falls back to "recent". Kept
// identical to the desktop mapping in src-tauri/src/db.rs.
const SORT_ORDER: Record<string, string> = {
  recent: "favorite DESC, created_at DESC",
  "most-used": "favorite DESC, copy_count DESC, created_at DESC",
  "recently-used": "favorite DESC, last_used_at DESC, created_at DESC",
  alpha: "favorite DESC, title COLLATE NOCASE ASC",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = searchParams.get("language");
  const search = searchParams.get("search");
  const tag = searchParams.get("tag");
  const searchMode = searchParams.get("searchMode") || "all";
  const db = dbForRequest(request);

  try {
    // Trash view: return only the soft-deleted (tombstoned) rows, newest-deleted
    // first. These are hidden from every other read; they persist so deletions
    // sync and can be restored.
    if (searchParams.get("deleted") === "1") {
      // Exclude emptied ("purged") tombstones so an emptied Trash looks empty
      // while the tombstone itself lives on for sync.
      const rows = db
        .prepare(
          "SELECT * FROM snippets WHERE deleted = 1 AND (title != '' OR code != '') ORDER BY updated_at DESC"
        )
        .all() as Record<string, unknown>[];
      return NextResponse.json(rows.map(rowToSnippet));
    }

    // Hide soft-deleted (tombstoned) rows — they exist only so the deletion can
    // propagate to other machines during sync.
    let query = "SELECT * FROM snippets WHERE deleted = 0";
    const params: (string | number)[] = [];

    // Language filter
    if (language) {
      query += " AND language = ?";
      params.push(language);
    }

    // Tag filter (check if tag exists in JSON array)
    if (tag) {
      query += " AND tags LIKE ? ESCAPE '\\'";
      params.push(`%"${escapeLike(tag)}"%`);
    }

    // Search filter with mode
    if (search) {
      const searchLike = `%${escapeLike(search)}%`;
      if (searchMode === "tags") {
        query += " AND tags LIKE ? ESCAPE '\\'";
        params.push(searchLike);
      } else if (searchMode === "title") {
        query += " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')";
        params.push(searchLike, searchLike);
      } else {
        // Default ("all") mode: use the FTS5 full-text index (fast, tokenized,
        // and it also covers the prompt body). A non-empty query with no
        // searchable tokens matches nothing.
        const match = ftsMatchQuery(search);
        if (match === null) {
          query += " AND 0";
        } else {
          query += " AND id IN (SELECT rowid FROM snippets_fts WHERE snippets_fts MATCH ?)";
          params.push(match);
        }
      }
    }

    // Pinned (favorite) snippets float to the top; the rest of the order depends
    // on the requested sort (default newest-first). Unknown keys fall back safely.
    const sort = searchParams.get("sort") || "recent";
    query += ` ORDER BY ${SORT_ORDER[sort] ?? SORT_ORDER.recent}`;

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as Record<string, unknown>[];
    const snippets: Snippet[] = rows.map(rowToSnippet);

    return NextResponse.json(snippets);
  } catch (error) {
    console.error("Failed to fetch snippets:", error);
    return NextResponse.json(
      { error: "Failed to fetch snippets" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const db = dbForRequest(request);
  try {
    const body = await request.json();
    const { title, description, code, language, tags, model, kind, color, template, collection, icon } = body;

    if (!title || !code || !language) {
      return NextResponse.json(
        { error: "Title, code, and language are required" },
        { status: 400 }
      );
    }

    if (title.length > 255) {
      return NextResponse.json(
        { error: "Title must be 255 characters or fewer" },
        { status: 400 }
      );
    }

    if (!validLanguages.includes(language)) {
      return NextResponse.json(
        { error: "Invalid language" },
        { status: 400 }
      );
    }

    const sanitizedTags = sanitizeTags(tags);
    const sanitizedModel = sanitizeModel(model);
    const sanitizedKind = sanitizeKind(kind);
    const sanitizedColor = sanitizeColor(color);
    const sanitizedCollection = sanitizeCollection(collection);
    const sanitizedIcon = sanitizeIcon(icon);

    const stmt = db.prepare(`
      INSERT INTO snippets (uuid, title, description, code, language, tags, model, kind, color, template, collection, icon)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      randomUUID(),
      title,
      description || "",
      code,
      language,
      JSON.stringify(sanitizedTags),
      sanitizedModel,
      sanitizedKind,
      sanitizedColor,
      template === true ? 1 : 0,
      sanitizedCollection,
      sanitizedIcon
    );

    const newSnippet = db.prepare("SELECT * FROM snippets WHERE id = ?").get(result.lastInsertRowid) as Record<string, unknown>;

    return NextResponse.json(rowToSnippet(newSnippet), { status: 201 });
  } catch (error) {
    console.error("Failed to create snippet:", error);
    return NextResponse.json(
      { error: "Failed to create snippet" },
      { status: 500 }
    );
  }
}
