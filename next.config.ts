import type { NextConfig } from "next";

// TAURI_BUILD=true triggers a static export (used for the desktop app bundle).
// The API routes under app/api are removed before this build runs, since the
// Tauri desktop app talks to the Rust commands in src-tauri instead.
const isTauriBuild = process.env.TAURI_BUILD === "true";

const nextConfig: NextConfig = {
  ...(isTauriBuild ? { output: "export" as const } : {}),
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
