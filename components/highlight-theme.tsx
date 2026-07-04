"use client";

import { useTheme } from "next-themes";

// Served locally from public/hljs so the app stays fully offline and needs no
// external CDN (which also keeps the Content-Security-Policy strict).
const lightTheme = "/hljs/github.min.css";
const darkTheme = "/hljs/github-dark.min.css";

export function HighlightTheme() {
  const { resolvedTheme } = useTheme();

  // resolvedTheme is undefined until mounted; default to light so the server
  // and first client render agree (no hydration mismatch) while still shipping a
  // highlight stylesheet on first paint — the previous mount-gated render left
  // code unstyled until after hydration.
  const active = resolvedTheme === "dark" ? darkTheme : lightTheme;

  return (
    <>
      {/* Preload both themes so switching light/dark has no unstyled gap. */}
      <link rel="preload" as="style" href={lightTheme} />
      <link rel="preload" as="style" href={darkTheme} />
      {/* eslint-disable-next-line @next/next/no-css-tags */}
      <link rel="stylesheet" href={active} />
    </>
  );
}
