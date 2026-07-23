# SnipVault sync server — the existing Next.js web app, containerized.
#
# It serves the same /api/snippets CRUD the desktop app already speaks, backed
# by a SQLite file under /app/data (mount a volume there to persist it). Set
# SNIPVAULT_TOKEN to require a bearer token on every /api request.

# ---- Build stage: install deps (incl. native better-sqlite3) and build -------
FROM node:24-slim AS builder
WORKDIR /app

# Toolchain needed to compile the better-sqlite3 native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Install with the committed lockfile for reproducible builds. pnpm-workspace.yaml
# carries the onlyBuiltDependencies allowlist, without which a non-interactive
# install errors (ERR_PNPM_IGNORED_BUILDS) on better-sqlite3's native addon.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build the server bundle (API routes included — TAURI_BUILD is left unset).
COPY . .
RUN pnpm build

# Drop dev dependencies but keep the compiled native module and `next`, which
# `next start` needs at runtime (both live in "dependencies").
RUN pnpm prune --prod

# ---- Runtime stage: minimal image that runs `next start` ---------------------
FROM node:24-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN corepack enable

# The SQLite file lives here; declared as a volume so data survives rebuilds.
RUN mkdir -p /app/data && chown -R node:node /app
VOLUME /app/data

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next ./.next
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/next.config.ts ./next.config.ts

USER node
EXPOSE 3000

# Binds 0.0.0.0 so the server is reachable from other machines on the LAN.
CMD ["pnpm", "serve"]
