import { dbForRequest } from "@/lib/db";
import { NextResponse } from "next/server";
import pkg from "@/package.json";

// Richer status probe (token-gated, like every /api route). Unlike /api/health
// — which stays a minimal liveness check for the Docker healthcheck and older
// clients — this reports library size, last-write time, and the server version.
//
// In multi-user mode it reflects the *caller's own* vault: dbForRequest routes
// to the authenticated user's database, so this never exposes another user's
// data (and the anonymous landing page in proxy.ts stays generic — library size
// is only ever visible to a caller holding a valid token).
export async function GET(request: Request) {
  const db = dbForRequest(request);
  try {
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count, MAX(updated_at) AS lastWrite FROM snippets WHERE deleted = 0"
      )
      .get() as { count: number; lastWrite: string | null };
    return NextResponse.json({
      ok: true,
      count: row.count,
      lastWrite: row.lastWrite ?? null,
      version: pkg.version,
    });
  } catch (error) {
    console.error("Status check failed:", error);
    return NextResponse.json(
      { ok: false, error: "Database unavailable" },
      { status: 500 }
    );
  }
}
