import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Token gate for the self-hosted sync server.
//
// When SNIPVAULT_TOKEN is set (the intended configuration for a homeserver
// deployment), every /api request must carry `Authorization: Bearer <token>`.
// When it is unset, requests pass through untouched — this keeps local web
// development and the bundled desktop web-export working exactly as before.
//
// The desktop app talks to this server through the Tauri HTTP plugin, which
// bypasses browser CORS, so no CORS headers are needed here.

const TOKEN = process.env.SNIPVAULT_TOKEN;

// Length-aware constant-time comparison. Runs in the Edge runtime, so it uses
// TextEncoder rather than Node's Buffer/crypto. It always scans the full length
// and folds any byte (or length) difference into a single accumulator, so it
// does not leak where or whether the strings diverge via timing.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function proxy(request: NextRequest) {
  // No token configured → open server (local dev / unauthenticated use).
  if (!TOKEN) return NextResponse.next();

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return unauthorized();

  const presented = header.slice(prefix.length);
  if (!timingSafeEqual(presented, TOKEN)) return unauthorized();

  return NextResponse.next();
}

// Guard only the API surface; static assets and pages are untouched.
export const config = {
  matcher: "/api/:path*",
};
