import { db, rowToSnippet } from "@/lib/db";
import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";

const validLanguages = LANGUAGES.map((l) => l.value);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { title, description, code, language, tags, model } = body;

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

    const sanitizedTags = Array.isArray(tags)
      ? tags.map((t: string) => t.trim().toLowerCase()).filter(Boolean).slice(0, 20)
      : [];

    const sanitizedModel =
      typeof model === "string" ? model.trim().slice(0, 100) : "";

    const stmt = db.prepare(`
      UPDATE snippets
      SET title = ?, description = ?, code = ?, language = ?, tags = ?, model = ?, updated_at = datetime('now')
      WHERE id = ?
    `);

    const result = stmt.run(
      title,
      description || "",
      code,
      language,
      JSON.stringify(sanitizedTags),
      sanitizedModel,
      parseInt(id)
    );

    if (result.changes === 0) {
      return NextResponse.json(
        { error: "Snippet not found" },
        { status: 404 }
      );
    }

    const updated = db.prepare("SELECT * FROM snippets WHERE id = ?").get(parseInt(id)) as Record<string, unknown>;

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
  try {
    const body = await request.json();
    const { favorite } = body;

    if (typeof favorite !== "boolean") {
      return NextResponse.json(
        { error: "favorite (boolean) is required" },
        { status: 400 }
      );
    }

    const stmt = db.prepare(
      "UPDATE snippets SET favorite = ? WHERE id = ?"
    );
    const result = stmt.run(favorite ? 1 : 0, parseInt(id));

    if (result.changes === 0) {
      return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
    }

    const updated = db
      .prepare("SELECT * FROM snippets WHERE id = ?")
      .get(parseInt(id)) as Record<string, unknown>;

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
  try {
    const stmt = db.prepare("DELETE FROM snippets WHERE id = ?");
    const result = stmt.run(parseInt(id));

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
