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

### Quickest — one command

If you just want a single-user server running with a generated token and don't
need the repo checked out, run the installer. It pulls the prebuilt image,
generates a strong token, writes a `.env` + `docker-compose.yml` into
`./snipvault/`, and starts the container — then prints the URL and token to
paste into the desktop app:

```bash
curl -fsSL https://raw.githubusercontent.com/FranciszekRyszka/Snippet-Vault/main/install.sh | sh
```

Prefer to read it first? Download `install.sh`, skim it, then `sh install.sh`.
Re-running is safe — it keeps your existing token and data and just pulls the
latest image and restarts (that's also how you update). Knobs:
`SNIPVAULT_DIR`, `SNIPVAULT_PORT`, and `SNIPVAULT_TOKEN` (to supply your own).

### Full checkout (for HTTPS, multiple users, backups, or building locally)

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

### Portainer / Unraid

On a NAS or a Portainer host you don't need the installer or a checkout — add a
**Stack** (Portainer) or a **Compose** project (Unraid's Compose Manager) and
paste this minimal stack, setting a strong token in the environment:

```yaml
services:
  snipvault:
    image: ghcr.io/franciszekryszka/snippet-vault:latest
    container_name: snipvault
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      SNIPVAULT_TOKEN: paste-a-long-random-token-here
    volumes:
      - snipvault-data:/app/data
volumes:
  snipvault-data:
```

Deploy the stack, then point the desktop app at `http://<nas-ip>:3000` with that
token. The `snipvault-data` volume keeps your library across image updates.

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
back that file up. To place it elsewhere, set `SNIPVAULT_DB_PATH` to the full
file path you want (the parent directory is created if needed).

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

## Multiple users (one server, private vaults)

By default the server is **single-user**: one `SNIPVAULT_TOKEN` guards one shared
library. To let several people share the same server while keeping their snippets
**private to each of them**, set `SNIPVAULT_TOKENS` instead — a comma-separated
list of `user:token` pairs:

```bash
# in .env — generate one token per user, e.g. openssl rand -base64 32
SNIPVAULT_TOKENS=alice:ALICE_TOKEN,bob:BOB_TOKEN
```

Each user gets their **own** database file under `data/users/<user>/snippets.db`.
Isolation is *structural* — every request is routed to the caller's own file by
their token, so one user physically cannot read or sync another's data. User ids
may contain letters, digits, `_` and `-` (1–64 characters).

- **Nothing changes in the desktop app** — each person just enters the server URL
  and **their own** token in **Settings → Sync server**.
- **Precedence:** if both `SNIPVAULT_TOKENS` and `SNIPVAULT_TOKEN` are set, the
  multi-user list wins and the single token is ignored.
- **Adding/removing a user** = edit `SNIPVAULT_TOKENS` and restart the server.
- **The `./data` volume already persists everything**, including per-user files.
- **Migrating an existing single-user library:** either keep it as-is (it stays
  the default single-user file), or move `data/snippets.db` to
  `data/users/<user>/snippets.db` to hand it to a named user.

With several people's data on one box, **use HTTPS** (see below) and give each
user a strong, unique token.

---

## HTTPS with a reverse proxy

Traffic is plain HTTP by default, which is usually fine on a trusted home LAN.
Once the server is reachable more widely — or shared between several users — put
a reverse proxy in front to terminate **HTTPS**. `docker-compose.yml` ships
ready-to-enable, commented services for **three** proxies; pick **one**.

Whichever you choose, the steps are the same shape:

1. Your domain must resolve to the host, and ports **80 + 443** must be reachable.
2. In `docker-compose.yml`, **remove the `ports:` mapping on the `snipvault`
   service** so it's only reachable inside the compose network — the proxy
   becomes the public entrypoint.
3. Bring it up (`docker compose up -d`) and point each desktop app at
   `https://<your-domain>` (no `:3000`).

All three forward the client IP in `X-Forwarded-For`, which the server's auth
rate-limiter uses to tell callers apart.

### Caddy (simplest — automatic certificates)

```bash
cp Caddyfile.example Caddyfile      # set your domain + email inside
# uncomment the `caddy` service in docker-compose.yml, then:
docker compose up -d
```

Caddy obtains and renews a Let's Encrypt certificate automatically; it's stored
in the `caddy-data` volume so it survives restarts.

### Traefik (automatic certificates, Docker labels)

Uncomment the `traefik` service, set the ACME email in its `command:`, and add
the `traefik.*` **labels** shown in the compose file to the `snipvault` service
(set your domain in the `Host(...)` rule). Traefik discovers the container via
those labels and provisions a Let's Encrypt cert automatically (stored in the
`traefik-letsencrypt` volume). Then `docker compose up -d`.

### nginx (you supply the certificates)

nginx doesn't provision certificates itself — obtain them first (e.g. with
[certbot](https://certbot.eff.org/)) and drop `fullchain.pem` + `privkey.pem`
into `./certs`:

```bash
cp nginx.example.conf nginx.conf    # set your domain inside
# put fullchain.pem + privkey.pem in ./certs, uncomment the `nginx` service, then:
docker compose up -d
```

> The example config sets `client_max_body_size 32m` — nginx's 1 MB default
> would reject a large sync push, so don't drop that line.

---

## Backing up the server

The whole library is a single SQLite file. On the server that's the file
`SNIPVAULT_DB_PATH` points at, or — with the default Docker setup —
`snippets.db` inside the `snipvault-data` volume (mounted at `/app/data`). Back
**that file** up and you've captured everything: prompts, tags, usage, and the
sync tombstones.

Because the server runs SQLite in **WAL mode**, don't just `cp` the live file
mid-write — you can catch a torn copy. Take a *consistent* snapshot instead:

```bash
# On the server (or via `docker exec snipvault sqlite3 ...`):
sqlite3 /app/data/snippets.db ".backup '/some/where/snipvault-$(date +%F).db'"
# equivalently:
sqlite3 /app/data/snippets.db "VACUUM INTO '/some/where/snipvault-$(date +%F).db'"
```

Both read through SQLite's online-backup machinery, so the copy is safe even
while the server is handling syncs. Point your backup tool (restic, Duplicati,
Borg, a cloud-sync folder, cron…) at the resulting file. To restore, stop the
server, put the file back at the database path, and start it again.

### Automated snapshots (Docker)

`docker-compose.yml` ships a commented-out **`backup`** sidecar that does this on
a schedule — a tiny Alpine container that runs a consistent `.backup` into a host
`./backups/` folder once a day and keeps the newest ~14. Uncomment it, then:

```bash
mkdir -p backups
docker compose up -d
```

Your external backup tool can then simply watch `./backups/`.

> The **desktop** app has its own equivalent: **Settings → Backups folder**
> (Back up now / auto-backup on launch / Restore). This section is only about the
> server's copy.

---

## Security notes

- **Always set a token on a real deployment** (`SNIPVAULT_TOKEN`, or
  `SNIPVAULT_TOKENS` for multiple users). With neither set, a production server
  refuses every request rather than exposing the library.
- Tokens are checked in **constant time** on every `/api` request, and each is
  scanned in full so timing can't reveal which user matched.
- **Brute force is rate-limited.** Repeated failed auth attempts from one client
  are throttled with a `429` (tune via `SNIPVAULT_RATELIMIT_MAX` /
  `SNIPVAULT_RATELIMIT_WINDOW_MS`). Valid clients are never throttled. Behind a
  reverse proxy this relies on the `X-Forwarded-For` header being set (Caddy does).
- Traffic is **plain HTTP** unless you front it with TLS. On a trusted home LAN
  that's usually fine; expose it more widely and you should use HTTPS — see
  [HTTPS with Caddy](#https-with-caddy).
- Don't forward the port to the public internet unless you know what you're
  doing — a token over plain HTTP is not enough protection on the open web.
- **Richer status:** `GET /api/status` (token-gated, per-user) returns the
  library size, last-write time, and server version — handy for monitoring.
