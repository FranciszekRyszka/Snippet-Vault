# SnipVault website

A tiny, self-contained marketing site for SnipVault. **No build step, no
dependencies** — three static files you can open in a browser and deploy anywhere.

```
website/
├─ index.html   # the whole single-scroll page
├─ styles.css   # design system + layout (light/dark, tokens, mockups)
├─ main.js      # theme toggle, mobile menu, scroll reveal, OS detect, copy button
└─ assets/      # (add) og.png + real screenshots
```

## Preview locally

Just open `index.html`, or serve the folder (nicer for correct paths):

```bash
cd website
python3 -m http.server 8080      # → http://localhost:8080
# or: npx serve .
```

## What's here vs. what to add

The page is complete and looks finished thanks to **pure HTML/CSS mockups** (the
hero app window, the fill-vars panel, the diff, etc.). Before launch, swap in
real assets for extra polish:

- **`assets/og.png`** (1200×630) — link-preview image (referenced in `<head>`).
- **Screenshots / short clips** — capture the app on a **dark** theme against a
  curated demo library, then replace a mockup block with an `<img>`/`<video>`.
  Best candidates: fill-a-variable → copy, ⌘K search, quick capture, split diff.

All copy, links, and structure follow `website.md` (the plan). Update the two
things that may change:

- The **canonical / OG URL** in `<head>` (currently the GitHub Pages URL guess).
- Download links point at the repo's **Releases → latest**; keep as-is.

## Deploy (GitHub Pages)

Pages can serve this folder directly. Options:

1. **Repo setting** — Settings → Pages → deploy from a branch, folder `/website`
   (or move these files to a `docs/` or a dedicated `gh-pages` branch).
2. **Actions** — a minimal workflow that uploads `website/` as the Pages
   artifact.

It's fully static, so **Cloudflare Pages** or **Vercel** work too (set the output
directory to `website`, no build command).

## Notes

- Fonts are system + monospace (no external font request) — fast and private,
  matching the app's pitch. To use Inter/Geist, self-host the woff2 in `assets/`
  and add an `@font-face`; don't add a Google Fonts `<link>`.
- No analytics by default. If you want any, use a cookieless option (Plausible/
  Umami) so it doesn't undercut the privacy story.
- Accessibility: semantic landmarks, skip link, visible focus, reduced-motion
  honored, AA contrast in both themes.
