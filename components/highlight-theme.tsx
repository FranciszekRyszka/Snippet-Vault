"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export function HighlightTheme() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Served locally from public/hljs so the app stays fully offline and needs no
  // external CDN (which also keeps the Content-Security-Policy strict).
  const lightTheme = "/hljs/github.min.css";
  const darkTheme = "/hljs/github-dark.min.css";

  return (
    // eslint-disable-next-line @next/next/no-css-tags
    <link
      rel="stylesheet"
      href={resolvedTheme === "dark" ? darkTheme : lightTheme}
    />
  );
}
