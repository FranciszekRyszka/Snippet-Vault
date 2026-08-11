// Boots the built Next.js server in MULTI-USER mode against a throwaway data
// directory, runs the multi-user isolation suite against it, then tears
// everything down. Mirrors run-api-tests.mjs (see it for the Windows
// process-kill and DB-cleanup rationale).

import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const isWin = process.platform === "win32";
const PORT = process.env.MU_PORT || "3998";
const TOK_A = "mu-a-" + randomUUID();
const TOK_B = "mu-b-" + randomUUID();
const DATA_DIR = path.join(tmpdir(), `snipvault-mu-${randomUUID()}`);
const BASE = `http://127.0.0.1:${PORT}`;

const nextCli = path.join("node_modules", "next", "dist", "bin", "next");

function runNode(args, extraEnv = {}) {
  return spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
}

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, {
        headers: { Authorization: `Bearer ${TOK_A}` },
      });
      if (res.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not become healthy within 30s");
}

function stopServer(server) {
  if (server.exitCode !== null) return;
  if (isWin) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
}

function cleanupData() {
  try {
    rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

if (!existsSync(path.join(".next", "BUILD_ID"))) {
  console.log("[mu-test] .next not found — running `next build` first…");
  const build = runNode([nextCli, "build"]);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log(`[mu-test] starting multi-user server on ${BASE} (data: ${DATA_DIR})`);
const server = spawn(
  process.execPath,
  [nextCli, "start", "-H", "127.0.0.1", "-p", PORT],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      SNIPVAULT_TOKENS: `a:${TOK_A},b:${TOK_B}`,
      SNIPVAULT_DATA_DIR: DATA_DIR,
      PORT,
    },
  }
);

let exitCode = 1;
try {
  await waitForHealth();
  const result = runNode(["--test", "test/multiuser.test.mjs"], {
    SNIPVAULT_URL: BASE,
    SNIPVAULT_TOKEN_A: TOK_A,
    SNIPVAULT_TOKEN_B: TOK_B,
  });
  exitCode = result.status ?? 1;
} catch (err) {
  console.error("[mu-test]", err.message);
} finally {
  stopServer(server);
  cleanupData();
}

process.exit(exitCode);
