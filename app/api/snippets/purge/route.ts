import { dbForRequest } from "@/lib/db";
import { NextResponse } from "next/server";

// Empty the Trash: blank the content of every tombstone (title/description/code/
// tags/model) while keeping the row as a deleted tombstone, so the deletion
// still can't be resurrected by a peer on the next sync. `updated_at` is bumped
// so the emptied state propagates. Returns how many were purged.
export async function POST(request: Request) {
  const db = dbForRequest(request);
  try {
    const now = "datetime('now')";
    const result = db
      .prepare(
        `UPDATE snippets
         SET title = '', description = '', code = '', tags = '[]', model = '', updated_at = ${now}
         WHERE deleted = 1 AND (title != '' OR code != '')`
      )
      .run();
    return NextResponse.json({ purged: result.changes });
  } catch (error) {
    console.error("Failed to empty trash:", error);
    return NextResponse.json(
      { error: "Failed to empty trash" },
      { status: 500 }
    );
  }
}
