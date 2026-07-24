// TAURI_BUILD=true triggers a static export (used for the desktop app bundle).
// The API routes under app/api are removed before this build runs, since the
// Tauri desktop app talks to the Rust commands in src-tauri instead.
//
// This config is plain JS (not .ts) on purpose: `next start` loads the config
// file at runtime and would need the `typescript` package to transpile a .ts
// one — but the production Docker image prunes dev dependencies, so TypeScript
// isn't present there. Keeping it as .mjs avoids any runtime transpilation.
const isTauriBuild = process.env.TAURI_BUILD === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(isTauriBuild ? { output: "export" } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
