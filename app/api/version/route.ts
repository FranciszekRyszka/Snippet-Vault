import { NextResponse } from "next/server";
import pkg from "@/package.json";

// Public, token-free server identity/version probe. Unlike /api/status (which is
// token-gated and reads the caller's vault), this touches no database and
// exposes only the software version — which is already public on GitHub — so a
// monitor, a CLI, or the desktop "Test & connect" flow can check "what is this
// server, and is it up to date" without a token.
//
// The middleware (proxy.ts) lets this one path through before the auth gate.
// Operators who'd rather not advertise the exact version can set
// SNIPVAULT_HIDE_VERSION=1 to return just the identity.
export function GET() {
  const body: Record<string, string> = { name: "snipvault-server" };
  if (process.env.SNIPVAULT_HIDE_VERSION !== "1") body.version = pkg.version;
  return NextResponse.json(body, {
    headers: { "cache-control": "public, max-age=60" },
  });
}
