"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

// Served locally from public/hljs so the app stays fully offline and needs no
// external CDN (which also keeps the Content-Security-Policy strict).
const lightTheme = "/hljs/github.min.css";
const darkTheme = "/hljs/github-dark.min.css";

export function HighlightTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // The static export can't know the user's theme, so the server always emits
  // the light stylesheet. A dark client resolves to dark on its very first
  // render, which would make this <link>'s href differ from the server and throw
  // a hydration mismatch. (React 19 treats a stylesheet <link> as a hoisted
  // resource, so `suppressHydrationWarning` doesn't apply to it.) So until
  // mounted we render the same light href the server did — hydration matches —
  // then swap to the resolved theme. Both themes are preloaded, so the post-mount
  // swap is instant and code is never left unstyled.
  const active = mounted && resolvedTheme === "dark" ? darkTheme : lightTheme;

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
