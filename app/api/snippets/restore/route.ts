import { db, rowToSnippet } from "@/lib/db";
import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";
import {
  sanitizeTags,
  sanitizeModel,
  validTimestampOr,
} from "@/lib/api-utils";

const validLanguages = new Set<string>(LANGUAGES.map((l) => l.value));

// Re-insert a previously deleted snippet, preserving its fields (favorite,
// model, usage counts, timestamps). Backs undo-after-delete. The restored row
// gets a new autoincrement id. Every field is validated/normalized the same way
// the create route does, plus a few restore-specific guards, so a crafted
// request can't inject a fractional copy_count (which would later break reads),
// a "truthy" favorite, or an out-of-range timestamp.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      title,
      description,
      code,
      language,
      tags,
      favorite,
      model,
      copy_count,
      last_used_at,
      created_at,
      updated_at,
    } = body;

    if (
      typeof title !== "string" ||
      !title ||
      typeof code !== "string" ||
      !code ||
      typeof language !== "string" ||
      !validLanguages.has(language)
    ) {
      return NextResponse.json(
        { error: "A valid snippet is required" },
        { status: 400 }
      );
    }

    if (title.length > 255) {
      return NextResponse.json(
        { error: "Title must be 255 characters or fewer" },
        { status: 400 }
      );
    }

    const sanitizedTags = sanitizeTags(tags);
    const sanitizedModel = sanitizeModel(model);

    // Must be a non-negative integer: a REAL (e.g. 1.5) stored in the INTEGER
    // column makes the desktop's typed read fail for the whole list.
    const sanitizedCopyCount =
      typeof copy_count === "number" && Number.isFinite(copy_count)
        ? Math.max(0, Math.floor(copy_count))
        : 0;

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const createdAt = validTimestampOr(created_at, now);
    const updatedAt = validTimestampOr(updated_at, now);
    const lastUsedAt = validTimestampOr(last_used_at, null);

    const stmt = db.prepare(`
      INSERT INTO snippets (title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      typeof description === "string" ? description : "",
      code,
      language,
      JSON.stringify(sanitizedTags),
      favorite === true ? 1 : 0,
      sanitizedModel,
      sanitizedCopyCount,
      lastUsedAt,
      createdAt,
      updatedAt
    );

    const restored = db
      .prepare("SELECT * FROM snippets WHERE id = ?")
      .get(result.lastInsertRowid) as Record<string, unknown>;

    return NextResponse.json(rowToSnippet(restored), { status: 201 });
  } catch (error) {
    console.error("Failed to restore snippet:", error);
    return NextResponse.json(
      { error: "Failed to restore snippet" },
      { status: 500 }
    );
  }
}
