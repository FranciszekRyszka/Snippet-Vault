import React from "react"
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { HighlightTheme } from "@/components/highlight-theme";
import { ACCENT_INIT_SCRIPT } from "@/lib/accent";
import "./globals.css";

const _geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const _geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "SnipVault - Code Snippets Library",
  description:
    "Save, organize, and find your code snippets with syntax highlighting and language support.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${_geist.variable} ${_geistMono.variable}`}
    >
      <head>
        {/* Apply the saved accent hue before paint to avoid a color flash. */}
        <script dangerouslySetInnerHTML={{ __html: ACCENT_INIT_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <HighlightTheme />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
