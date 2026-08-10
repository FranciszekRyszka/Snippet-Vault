import { rewriteTag } from "@/lib/db";
import { NextResponse } from "next/server";

// Rename, merge, or delete a tag library-wide.
//   { from: "old", to: "new" }   → rename (merges if "new" already exists)
//   { from: "old", to: null }    → delete the tag everywhere
// Returns { changed } — the number of entries whose tags were rewritten.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const from = typeof body?.from === "string" ? body.from : "";
    if (!from.trim()) {
      return NextResponse.json({ error: "Missing 'from' tag" }, { status: 400 });
    }
    // Absent or null `to` means delete; a string renames/merges. Any other type
    // is treated as a delete rather than erroring.
    const to = typeof body?.to === "string" ? body.to : null;
    const changed = rewriteTag(from, to);
    return NextResponse.json({ changed });
  } catch (error) {
    console.error("Failed to rewrite tag:", error);
    return NextResponse.json(
      { error: "Failed to rewrite tag" },
      { status: 500 }
    );
  }
}
