import { db, rowToSnippet } from "@/lib/db";
import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";
import { parseId, sanitizeTags, sanitizeModel, sanitizeKind } from "@/lib/api-utils";

const validLanguages = LANGUAGES.map((l) => l.value);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numericId = parseId(id);
  if (numericId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const { title, description, code, language, tags, model, kind } = body;

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

    const stmt = db.prepare(`
      UPDATE snippets
      SET title = ?, description = ?, code = ?, language = ?, tags = ?, model = ?, kind = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(
      title,
      description || "",
      code,
      language,
      JSON.stringify(sanitizedTags),
      sanitizedModel,
      sanitizedKind,
      numericId
    );

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Snippet not found" },
        { status: 404 }
      );
    }

    const updated = db.prepare("SELECT * FROM snippets WHERE id = ?").get(numericId) as Record<string, unknown>;

    return NextResponse.json(rowToSnippet(updated));
  } catch (error) {
    console.error("Failed to update snippet:", error);
    return NextResponse.json(
      { error: "Failed to update snippet" },
      { status: 500 }
    );
  }
}

// Partial update — currently just the `favorite` (pin) flag.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numericId = parseId(id);
  if (numericId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    const body = await request.json();
    const { favorite } = body;

    if (typeof favorite !== "boolean") {
      return NextResponse.json(
        { error: "favorite (boolean) is required" },
        { status: 400 }
      );
    }

    // Bump updated_at so a pin/unpin wins during sync (newest edit wins).
    const stmt = db.prepare(
      "UPDATE snippets SET favorite = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const result = stmt.run(favorite ? 1 : 0, numericId);

    if (result.changes === 0) {
      return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
    }

    const updated = db
      .prepare("SELECT * FROM snippets WHERE id = ?")
      .get(numericId) as Record<string, unknown>;

    return NextResponse.json(rowToSnippet(updated));
  } catch (error) {
    console.error("Failed to update favorite:", error);
    return NextResponse.json(
      { error: "Failed to update favorite" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numericId = parseId(id);
  if (numericId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    // Soft-delete: flag the row as a tombstone and bump updated_at so the
    // deletion propagates to other machines on the next sync. The row itself
    // stays in the database (hidden from every read).
    const stmt = db.prepare(
      "UPDATE snippets SET deleted = 1, updated_at = datetime('now') WHERE id = ? AND deleted = 0"
    );
    const result = stmt.run(numericId);

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Snippet not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete snippet:", error);
    return NextResponse.json(
      { error: "Failed to delete snippet" },
      { status: 500 }
    );
  }
}
