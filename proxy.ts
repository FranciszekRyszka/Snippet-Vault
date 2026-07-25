import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Token gate for the self-hosted sync server.
//
// When SNIPVAULT_TOKEN is set (the intended configuration for a homeserver
// deployment), every /api request must carry `Authorization: Bearer <token>`.
//
// When it is unset:
//   * In development (local `next dev`, the bundled desktop web-export),
//     requests pass through untouched — no token is expected there.
//   * In production, the server fails CLOSED — every /api request is refused —
//     unless the operator explicitly opts into an open server with
//     SNIPVAULT_ALLOW_NO_AUTH=1. This stops the bare image (`docker run`
//     without a token) from silently serving the whole library to anyone on the
//     network. docker-compose already refuses to start without the token; this
//     is the defense for people who bypass compose.
//
// The desktop app talks to this server through the Tauri HTTP plugin, which
// bypasses browser CORS, so no CORS headers are needed here.

const TOKEN = process.env.SNIPVAULT_TOKEN;
const IS_PROD = process.env.NODE_ENV === "production";
const ALLOW_NO_AUTH = process.env.SNIPVAULT_ALLOW_NO_AUTH === "1";

// A production server with no token and no explicit opt-in is misconfigured:
// refuse everything rather than expose the library.
const LOCKED_OUT = IS_PROD && !TOKEN && !ALLOW_NO_AUTH;

// Warn/err once, when this module is first loaded (i.e. at server startup), so
// the state is obvious in the container logs instead of failing silently.
if (IS_PROD && !TOKEN) {
  if (ALLOW_NO_AUTH) {
    console.warn(
      "[SnipVault] SNIPVAULT_TOKEN is not set and SNIPVAULT_ALLOW_NO_AUTH=1 — " +
        "the API is running UNAUTHENTICATED. Anyone who can reach this server " +
        "can read and modify the entire library."
    );
  } else {
    console.error(
      "[SnipVault] SNIPVAULT_TOKEN is not set — refusing all /api requests. " +
        "Set SNIPVAULT_TOKEN to a strong random value (see .env.example), or " +
        "set SNIPVAULT_ALLOW_NO_AUTH=1 to intentionally run an open server."
    );
  }
}

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
  // Misconfigured production server (no token, no opt-in): fail closed.
  if (LOCKED_OUT) {
    return NextResponse.json(
      { error: "Server not configured: SNIPVAULT_TOKEN is required." },
      { status: 503 }
    );
  }

  // No token configured but allowed (local dev, or explicit no-auth opt-in) →
  // pass through.
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
