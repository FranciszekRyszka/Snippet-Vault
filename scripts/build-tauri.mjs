// Builds the static frontend bundle consumed by the Tauri desktop app.
//
// The desktop app talks to the Rust commands in src-tauri instead of the
// Next.js API routes, and `output: "export"` cannot coexist with the
// app/api route handlers. So this script temporarily moves app/api out of
// the way, runs a static export build (-> out/), and restores app/api
// afterwards.

import { existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "app", "api");
const apiTmpDir = path.join(root, "app", "_api.tauri-build-tmp");

let moved = false;
let exitCode = 0;
try {
  if (existsSync(apiDir)) {
    renameSync(apiDir, apiTmpDir);
    moved = true;
  }

  const result = spawnSync("next build", {
    cwd: root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, TAURI_BUILD: "true" },
  });

  // Record the failure but don't exit here: exiting inside `try` would skip the
  // `finally` below and leave app/api renamed away, breaking the web app until
  // it's manually restored.
  exitCode = result.status ?? 1;
} finally {
  if (moved) {
    renameSync(apiTmpDir, apiDir);
  }
}

process.exit(exitCode);
