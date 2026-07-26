# Self-hosting the SnipVault sync server

Run SnipVault on a machine on your network (a homeserver, NAS, spare PC) and
point every SnipVault desktop app at it. Each app keeps its **own local library**
and **syncs** with the server — so your snippets are always there even when the
server isn't, and every machine converges on the same set.

Syncing is **incremental and two-way**: each machine pushes what it has and pulls
what the server has, so new snippets flow in both directions. It runs on app
startup and whenever you click **Sync now**. See
[How syncing works](#how-syncing-works) for the details.

---

## What you get

- One library kept in sync across all your computers.
- Works offline — you edit your local copy and it reconciles on the next sync.
- New snippets, edits, and deletions all propagate between machines.
- Access protected by a **bearer token** you choose.
- Your data stays on hardware you control.

---

## Option 1 — Docker (recommended)

Requires Docker and the Docker Compose plugin.

```bash
# 1. Get the code on the server
git clone https://github.com/FranciszekRyszka/Snippet-Vault.git
cd Snippet-Vault

# 2. Create your token
cp .env.example .env
# edit .env and set SNIPVAULT_TOKEN to a long random value, e.g.:
#   openssl rand -base64 32

# 3. Build and start
docker compose up -d
```

The server now listens on port **3000** and stores its database in the
`snipvault-data` Docker volume (persists across rebuilds and image updates).

Check it from another machine on the network (replace the host and token):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://192.168.1.50:3000/api/health
# -> {"ok":true,"count":0}
```

A token-protected server has **no browser interface** — opening its URL shows a
short status page, not the app. That's expected: the token can only be entered in
the desktop app's **Settings → Sync server**, so the server is a sync API, not a
web app. (Running without a token — an intentionally open server via
`SNIPVAULT_ALLOW_NO_AUTH=1` — does serve the full web UI in a browser.)

Update to a newer version later:

```bash
git pull
docker compose up -d --build
```

## Option 2 — Bare Node + systemd

If you'd rather not use Docker. Requires Node.js 20+ and pnpm, plus a C++
toolchain (`build-essential python3`) for the native SQLite module.

```bash
git clone https://github.com/FranciszekRyszka/Snippet-Vault.git
cd Snippet-Vault
pnpm install --frozen-lockfile
pnpm build
```

Create `/etc/systemd/system/snipvault.service`:

```ini
[Unit]
Description=SnipVault sync server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/Snippet-Vault
Environment=NODE_ENV=production
Environment=SNIPVAULT_TOKEN=your-long-random-token
ExecStart=/usr/bin/pnpm serve
Restart=on-failure
User=snipvault

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now snipvault
```

The database is written to `data/snippets.db` inside the working directory —
back that file up.

---

## Connecting the app

In each SnipVault desktop app:

1. Open **Settings** (or, on a fresh install, choose **Connect to a sync
   server** on the first-run screen).
2. Enter the server URL (e.g. `http://192.168.1.50:3000`) and your token.
3. **Test & save.** The app verifies the server, saves it, and runs a first sync
   — pulling the server's snippets into this machine's local library.

Repeat on every machine using the same URL and token. From then on each app
syncs automatically on startup, and you can trigger a sync any time with
**Sync now** in Settings.

---

## How syncing works

Every snippet has a stable id (a `uuid`) and a last-modified timestamp, so the
same snippet is recognised across machines. On each sync:

- **Both directions merge.** Snippets that exist on only one side are copied to
  the other; the result is the union of everything.
- **Newest edit wins.** If the same snippet was changed on two machines, the one
  with the most recent modification time is kept (the older edit is overwritten).
- **Deletes propagate.** Deleting a snippet marks it as removed rather than
  erasing it. That "tombstone" syncs, so the snippet disappears everywhere — and
  can't be silently resurrected by a machine that still had a copy.

A couple of things worth knowing:

- **Keep clocks roughly in sync.** "Newest wins" compares each machine's clock.
  On a normal LAN that's fine; a badly-wrong clock could let a stale edit win.
- **Editing the same snippet on two offline machines** before they next sync
  keeps only the most recent version — the other edit is lost. Sync often to
  avoid surprises.

---

## Security notes

- **Always set `SNIPVAULT_TOKEN` on a real deployment.** With no token the API
  is open to anyone who can reach the server — anyone on your network could read
  and modify your library.
- The token is checked in constant time and required on every `/api` request.
- Traffic is **plain HTTP**. On a trusted home LAN that is usually fine. If you
  expose the server more widely, put a reverse proxy (Caddy, nginx, Traefik) in
  front to terminate **HTTPS**, and point the app at the `https://` URL.
- Don't forward the port to the public internet unless you know what you're
  doing — a token over plain HTTP is not enough protection on the open web.
