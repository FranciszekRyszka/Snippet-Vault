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

// A minimal landing page for the root URL of a token-protected sync server.
// The browser web UI can't authenticate against such a server (there's no place
// to enter the token — it's a desktop-only setting), so the real app would just
// render a dead shell whose every API call 401s. Serve this instead so a visitor
// sees what the endpoint is rather than a broken interface. Self-contained (no
// external assets), theme-aware.
function serverStatusPage() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>SnipVault sync server</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 15px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #fafafa; color: #18181b; padding: 24px; }
  .card { max-width: 34rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { margin: .5rem 0; color: #52525b; }
  code { background: rgba(127,127,127,.15); padding: .1em .4em; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9em; }
  a { color: #2563eb; }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #fafafa; }
    p { color: #a1a1aa; }
    a { color: #60a5fa; }
  }
</style>
</head>
<body>
  <div class="card">
    <h1>SnipVault sync server</h1>
    <p>This is the sync API for the SnipVault desktop app — there is no web
    interface here. Point the desktop app's <strong>Settings → Sync server</strong>
    at this URL with your access token.</p>
    <p>Health check: <code>GET /api/health</code></p>
    <p><a href="https://github.com/FranciszekRyszka/Snippet-Vault">Documentation &amp; downloads</a></p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  // The root page. On a token-protected server (a pure sync server) the browser
  // UI can't authenticate, so replace it with a small status page. When no token
  // is set — local dev, or an operator running an intentionally open web app via
  // SNIPVAULT_ALLOW_NO_AUTH — serve the real app untouched.
  if (request.nextUrl.pathname === "/") {
    return TOKEN ? serverStatusPage() : NextResponse.next();
  }

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

// Guard the API surface, plus the root page (swapped for a status page on a
// token-protected server). Other static assets and pages are untouched.
export const config = {
  matcher: ["/api/:path*", "/"],
};
