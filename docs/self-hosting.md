# Self-hosting the SnipVault sync server

Run SnipVault on a machine on your network (a homeserver, NAS, spare PC) and
point every SnipVault desktop app at it. All machines then read and write **one
shared library** — the server holds the single source of truth.

This is a *shared server*, not offline sync: the apps read and write live over
HTTP, so the server needs to be reachable when you use them.

---

## What you get

- One library, shared across all your computers.
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
3. **Test & connect.** The app switches to the shared library.

Repeat on every machine using the same URL and token.

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
