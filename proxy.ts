import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createRateLimiter } from "@/lib/rate-limit";

// Token gate for the self-hosted sync server.
//
// Two authenticated modes plus an unauthenticated dev mode:
//
//   * Single-tenant (SNIPVAULT_TOKEN set): every /api request must carry
//     `Authorization: Bearer <token>`. One shared library. This is the original
//     behaviour and is preserved byte-for-byte.
//
//   * Multi-user (SNIPVAULT_TOKENS set, e.g. "alice:tokA,bob:tokB"): each user
//     has their own token and their own private vault (a separate SQLite file —
//     see lib/db.ts). The matched user is forwarded to the route on the trusted
//     `x-snipvault-user` header. If both env vars are set, SNIPVAULT_TOKENS wins.
//
//   * Unset (local `next dev`, the bundled desktop web-export): requests pass
//     through untouched in development. In production the server fails CLOSED —
//     every /api request is refused — unless the operator opts into an open
//     server with SNIPVAULT_ALLOW_NO_AUTH=1. This stops the bare image
//     (`docker run` without a token) from silently serving the whole library.
//
// The desktop app talks to this server through the Tauri HTTP plugin, which
// bypasses browser CORS, so no CORS headers are needed here.

const TOKEN = process.env.SNIPVAULT_TOKEN;
const IS_PROD = process.env.NODE_ENV === "production";
const ALLOW_NO_AUTH = process.env.SNIPVAULT_ALLOW_NO_AUTH === "1";

// User ids become path segments (data/users/<user>/), so they're strictly
// validated. Mirrors USER_ID_RE in lib/db.ts.
const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Parse SNIPVAULT_TOKENS ("user1:tok1,user2:tok2") into a validated list.
// Malformed / invalid-id / empty-token / duplicate entries are skipped with a
// warning (user ids only — never the tokens) rather than throwing, so a single
// typo can't take the whole server down at import time.
function parseTokens(
  raw: string | undefined
): Array<{ user: string; token: string }> {
  if (!raw) return [];
  const out: Array<{ user: string; token: string }> = [];
  const seen = new Set<string>();
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) {
      console.warn(
        "[SnipVault] Ignoring malformed SNIPVAULT_TOKENS entry (expected user:token)."
      );
      continue;
    }
    const user = trimmed.slice(0, idx).trim();
    const token = trimmed.slice(idx + 1).trim();
    if (!USER_ID_RE.test(user)) {
      console.warn(
        "[SnipVault] Ignoring SNIPVAULT_TOKENS entry with an invalid user id " +
          "(allowed: A–Z a–z 0–9 _ - , 1–64 chars)."
      );
      continue;
    }
    if (!token) {
      console.warn(
        `[SnipVault] Ignoring SNIPVAULT_TOKENS entry for "${user}" with an empty token.`
      );
      continue;
    }
    if (seen.has(user)) {
      console.warn(
        `[SnipVault] Ignoring duplicate SNIPVAULT_TOKENS entry for user "${user}".`
      );
      continue;
    }
    seen.add(user);
    out.push({ user, token });
  }
  return out;
}

const TOKENS = parseTokens(process.env.SNIPVAULT_TOKENS);
const MULTI_USER = TOKENS.length > 0;

// A production server with no auth configured and no explicit opt-in is
// misconfigured: refuse everything rather than expose the library.
const LOCKED_OUT = IS_PROD && !TOKEN && !MULTI_USER && !ALLOW_NO_AUTH;

// Log the resolved auth mode once, at import (server startup), so the state is
// obvious in the container logs instead of failing silently.
if (MULTI_USER) {
  console.log(
    `[SnipVault] Multi-user mode: ${TOKENS.length} user token(s) configured.`
  );
  if (TOKEN) {
    console.warn(
      "[SnipVault] Both SNIPVAULT_TOKENS and SNIPVAULT_TOKEN are set — " +
        "SNIPVAULT_TOKENS takes precedence; SNIPVAULT_TOKEN is ignored."
    );
  }
} else if (IS_PROD && !TOKEN) {
  if (ALLOW_NO_AUTH) {
    console.warn(
      "[SnipVault] SNIPVAULT_TOKEN is not set and SNIPVAULT_ALLOW_NO_AUTH=1 — " +
        "the API is running UNAUTHENTICATED. Anyone who can reach this server " +
        "can read and modify the entire library."
    );
  } else {
    console.error(
      "[SnipVault] No SNIPVAULT_TOKEN or SNIPVAULT_TOKENS set — refusing all " +
        "/api requests. Set SNIPVAULT_TOKEN (single user) or SNIPVAULT_TOKENS " +
        "(multiple users) to a strong random value (see .env.example), or set " +
        "SNIPVAULT_ALLOW_NO_AUTH=1 to intentionally run an open server."
    );
  }
}

// In-memory sliding-window limiter on *failed* auth attempts, keyed by client
// IP, to blunt brute force against a weak token. Valid clients never record a
// failure, so honest sync traffic is never throttled. State lives in this Edge
// isolate (fine for a single-instance homeserver — see lib/rate-limit.ts).
const RATE_MAX = Number(process.env.SNIPVAULT_RATELIMIT_MAX) || 20;
const RATE_WINDOW_MS =
  Number(process.env.SNIPVAULT_RATELIMIT_WINDOW_MS) || 60_000;
const authFailures = createRateLimiter({
  max: RATE_MAX,
  windowMs: RATE_WINDOW_MS,
});

// Best-effort client identity for rate-limiting: the first x-forwarded-for hop.
// A reverse proxy in front (see the Caddy profile in docker-compose.yml) sets
// this; without it every caller shares one "global" bucket, which still bounds
// the total guess rate.
function clientKey(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  return "global";
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

function tooManyRequests(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(seconds) } }
  );
}

// Forward the request, controlling the trusted x-snipvault-user header: always
// strip any inbound value first (so a client can never assert its own user id),
// then set the resolved user only when there is one (a multi-user match).
// Single-tenant and dev leave it unset → routes fall back to the default vault.
function passThrough(request: NextRequest, user: string | null) {
  const headers = new Headers(request.headers);
  headers.delete("x-snipvault-user");
  if (user) headers.set("x-snipvault-user", user);
  return NextResponse.next({ request: { headers } });
}

// A minimal landing page for the root URL of a token-protected sync server.
// The browser web UI can't authenticate against such a server (there's no place
// to enter the token — it's a desktop-only setting), so the real app would just
// render a dead shell whose every API call 401s. Serve this instead so a visitor
// sees what the endpoint is rather than a broken interface. Self-contained (no
// external assets), theme-aware. Deliberately generic — it never reports library
// size or any per-user data to an unauthenticated visitor.
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
  // UI can't authenticate, so replace it with a small status page. When no auth
  // is configured — local dev, or an operator running an intentionally open web
  // app via SNIPVAULT_ALLOW_NO_AUTH — serve the real app untouched.
  if (request.nextUrl.pathname === "/") {
    return TOKEN || MULTI_USER ? serverStatusPage() : NextResponse.next();
  }

  // Misconfigured production server (no auth, no opt-in): fail closed.
  if (LOCKED_OUT) {
    return NextResponse.json(
      { error: "Server not configured: set SNIPVAULT_TOKEN or SNIPVAULT_TOKENS." },
      { status: 503 }
    );
  }

  // No auth configured but allowed (local dev, or explicit no-auth opt-in) →
  // pass through. Still strip any inbound user header so it can't be spoofed.
  if (!TOKEN && !MULTI_USER) {
    return passThrough(request, null);
  }

  // Throttle brute force before doing any token work.
  const key = clientKey(request);
  const limited = authFailures.isLimited(key);
  if (limited.limited) return tooManyRequests(limited.retryAfterMs);

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const presented = header.startsWith(prefix) ? header.slice(prefix.length) : "";

  if (MULTI_USER) {
    // Scan the whole list — no early return — so timing doesn't reveal which
    // (or whether any) token matched. Record the last match's user.
    let matched: string | null = null;
    for (const entry of TOKENS) {
      if (timingSafeEqual(presented, entry.token)) matched = entry.user;
    }
    if (matched === null) {
      authFailures.recordFailure(key);
      return unauthorized();
    }
    return passThrough(request, matched);
  }

  // Single-tenant: compare against the one configured token.
  if (!header.startsWith(prefix) || !timingSafeEqual(presented, TOKEN!)) {
    authFailures.recordFailure(key);
    return unauthorized();
  }
  return passThrough(request, null);
}

// Guard the API surface, plus the root page (swapped for a status page on a
// token-protected server). Other static assets and pages are untouched.
export const config = {
  matcher: ["/api/:path*", "/"],
};
