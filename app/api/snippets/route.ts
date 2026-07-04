import { db, rowToSnippet, type Snippet } from "@/lib/db";
import { NextResponse } from "next/server";
import { LANGUAGES } from "@/lib/languages";
import { escapeLike, sanitizeTags, sanitizeModel } from "@/lib/api-utils";

const validLanguages = LANGUAGES.map((l) => l.value);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const language = searchParams.get("language");
  const search = searchParams.get("search");
  const tag = searchParams.get("tag");
  const searchMode = searchParams.get("searchMode") || "all";

  try {
    let query = "SELECT * FROM snippets WHERE 1=1";
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
        // "all" mode - search title, description, tags, and model
        query += " AND (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR tags LIKE ? ESCAPE '\\' OR model LIKE ? ESCAPE '\\')";
        params.push(searchLike, searchLike, searchLike, searchLike);
      }
    }

    // Pinned (favorite) snippets float to the top, newest first within each group.
    query += " ORDER BY favorite DESC, created_at DESC";

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

    const sanitizedTags = sanitizeTags(tags);
    const sanitizedModel = sanitizeModel(model);

    const stmt = db.prepare(`
      INSERT INTO snippets (title, description, code, language, tags, model)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      title,
      description || "",
      code,
      language,
      JSON.stringify(sanitizedTags),
      sanitizedModel
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
