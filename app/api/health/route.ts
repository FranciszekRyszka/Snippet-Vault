import { db } from "@/lib/db";
import { NextResponse } from "next/server";

// Lightweight liveness/auth probe used by the desktop app's "Test & connect"
// button. Reaching this route past the auth middleware already proves the token
// is valid; the snippet count is a cheap confirmation the database is readable.
export async function GET() {
  try {
    const row = db.prepare("SELECT COUNT(*) AS count FROM snippets").get() as {
      count: number;
    };
    return NextResponse.json({ ok: true, count: row.count });
  } catch (error) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      { ok: false, error: "Database unavailable" },
      { status: 500 }
    );
  }
}
