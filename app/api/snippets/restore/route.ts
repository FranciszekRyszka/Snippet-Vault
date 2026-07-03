import { db, rowToSnippet } from "@/lib/db";
import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";

const validLanguages = LANGUAGES.map((l) => l.value);

// Re-insert a previously deleted snippet, preserving all its fields
// (favorite, model, usage counts, timestamps). Backs undo-after-delete.
// The restored row gets a new autoincrement id.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at } = body;

    if (!title || !code || !language || !validLanguages.includes(language)) {
      return NextResponse.json(
        { error: "A valid snippet is required" },
        { status: 400 }
      );
    }

    const tagsJson = JSON.stringify(Array.isArray(tags) ? tags : []);
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");

    const stmt = db.prepare(`
      INSERT INTO snippets (title, description, code, language, tags, favorite, model, copy_count, last_used_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      description || "",
      code,
      language,
      tagsJson,
      favorite ? 1 : 0,
      typeof model === "string" ? model : "",
      Number.isFinite(copy_count) ? copy_count : 0,
      typeof last_used_at === "string" ? last_used_at : null,
      typeof created_at === "string" ? created_at : now,
      typeof updated_at === "string" ? updated_at : now
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
