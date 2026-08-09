import { getRevisionsForId } from "@/lib/db";
import { NextResponse } from "next/server";
import { parseId } from "@/lib/api-utils";

// Past versions of a snippet (prompt history), newest first. Local to this
// database — revisions aren't synced.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numericId = parseId(id);
  if (numericId === null) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  try {
    return NextResponse.json(getRevisionsForId(numericId));
  } catch (error) {
    console.error("Failed to fetch revisions:", error);
    return NextResponse.json(
      { error: "Failed to fetch revisions" },
      { status: 500 }
    );
  }
}
