import { db, rowToSnippet } from "@/lib/db";
import { NextResponse } from "next/server";

// Record that a snippet was copied: bump its usage count and stamp the time.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const stmt = db.prepare(
      "UPDATE snippets SET copy_count = copy_count + 1, last_used_at = datetime('now') WHERE id = ?"
    );
    const result = stmt.run(parseInt(id));

    if (result.changes === 0) {
      return NextResponse.json({ error: "Snippet not found" }, { status: 404 });
    }

    const updated = db
      .prepare("SELECT * FROM snippets WHERE id = ?")
      .get(parseInt(id)) as Record<string, unknown>;

    return NextResponse.json(rowToSnippet(updated));
  } catch (error) {
    console.error("Failed to record copy:", error);
    return NextResponse.json(
      { error: "Failed to record copy" },
      { status: 500 }
    );
  }
}
