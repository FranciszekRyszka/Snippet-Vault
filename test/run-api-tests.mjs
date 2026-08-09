// Boots the built Next.js server against a throwaway SQLite database, waits for
// it to answer, runs the node:test API suite against it, then tears everything
// down. Cross-platform — no shell/symlink tricks — thanks to SNIPVAULT_DB_PATH.
//
// Assumes `next build` has already run; builds automatically if .next is absent.
// Exit code is the test run's exit code, so it drops straight into CI.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const isWin = process.platform === "win32";
const PORT = process.env.PORT || "3999";
const TOKEN = "citest-" + randomUUID();
const DB_PATH = path.join(tmpdir(), `snipvault-test-${randomUUID()}.db`);
const BASE = `http://127.0.0.1:${PORT}`;

// Invoke Next through node + its CLI entry rather than the .bin/next(.cmd)
// wrapper. On Windows the wrapper is a cmd.exe shim, and killing it orphans the
// real server (which then holds the inherited stdout open); calling node
// directly means the spawned pid IS the server, so it can be killed cleanly.
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
        headers: { Authorization: `Bearer ${TOKEN}` },
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
    // Kill the whole tree (next may spawn workers) — SIGTERM alone can orphan them.
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
}

function cleanupDb() {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB_PATH + suffix, { force: true });
    } catch {
      // best effort
    }
  }
}

if (!existsSync(path.join(".next", "BUILD_ID"))) {
  console.log("[test] .next not found — running `next build` first…");
  const build = runNode([nextCli, "build"]);
  if (build.status !== 0) process.exit(build.status ?? 1);
}

console.log(`[test] starting server on ${BASE} (db: ${DB_PATH})`);
const server = spawn(
  process.execPath,
  [nextCli, "start", "-H", "127.0.0.1", "-p", PORT],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      SNIPVAULT_TOKEN: TOKEN,
      SNIPVAULT_DB_PATH: DB_PATH,
      PORT,
    },
  }
);

let exitCode = 1;
try {
  await waitForHealth();
  const result = runNode(["--test", "test/api.test.mjs"], {
    SNIPVAULT_URL: BASE,
    SNIPVAULT_TOKEN: TOKEN,
  });
  exitCode = result.status ?? 1;
} catch (err) {
  console.error("[test]", err.message);
} finally {
  stopServer(server);
  cleanupDb();
}

process.exit(exitCode);
