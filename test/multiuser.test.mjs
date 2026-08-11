// Integration tests for the multi-user sync server (SNIPVAULT_TOKENS mode).
//
// Black-box over HTTP, like api.test.mjs, but focused on tenant isolation: two
// users (A and B) each authenticate with their own token and must only ever see
// their own vault. Run via `node test/run-multiuser-tests.mjs`, which boots a
// server with `SNIPVAULT_TOKENS="a:<tokA>,b:<tokB>"` against a throwaway data
// dir and points these at it. Zero dependencies (node:test + global fetch).

import { test, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.SNIPVAULT_URL ?? "http://127.0.0.1:3998";
const TOK_A = process.env.SNIPVAULT_TOKEN_A ?? "";
const TOK_B = process.env.SNIPVAULT_TOKEN_B ?? "";

const authOf = (tok) => ({ Authorization: `Bearer ${tok}` });
const jsonOf = (tok) => ({ "Content-Type": "application/json", ...authOf(tok) });

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

function create(tok, overrides = {}) {
  return api("/api/snippets", {
    method: "POST",
    headers: jsonOf(tok),
    body: JSON.stringify({ title: "iso", code: "x", language: "text", ...overrides }),
  });
}

function syncRecord(uuid, overrides = {}) {
  return {
    uuid,
    title: "rec",
    description: "",
    code: "hi",
    language: "text",
    tags: [],
    favorite: false,
    model: "",
    kind: "prompt",
    copy_count: 0,
    last_used_at: null,
    created_at: "2026-08-04 10:00:00",
    updated_at: "2026-08-04 10:00:00",
    deleted: false,
    ...overrides,
  };
}

before(async () => {
  const a = await api("/api/health", { headers: authOf(TOK_A) });
  assert.equal(a.status, 200, "user A token must be accepted");
  const b = await api("/api/health", { headers: authOf(TOK_B) });
  assert.equal(b.status, 200, "user B token must be accepted");
});

test("a bad token is rejected", async () => {
  const res = await api("/api/health", {
    headers: authOf("nope-" + crypto.randomUUID()),
  });
  assert.equal(res.status, 401);
});

test("each user sees only their own vault", async () => {
  const marker = "iso-" + crypto.randomUUID().slice(0, 8);
  const created = await create(TOK_A, { title: marker });
  assert.equal(created.status, 201);

  const aList = await api("/api/snippets", { headers: authOf(TOK_A) });
  assert.ok(aList.body.some((s) => s.title === marker), "A sees its own snippet");

  const bList = await api("/api/snippets", { headers: authOf(TOK_B) });
  assert.ok(
    !bList.body.some((s) => s.title === marker),
    "B must not see A's snippet by title"
  );
  assert.ok(
    !bList.body.some((s) => s.uuid === created.body.uuid),
    "B must not see A's snippet by uuid"
  );
});

test("status counts are per-user", async () => {
  const before = await api("/api/status", { headers: authOf(TOK_B) });
  assert.equal(before.status, 200);
  assert.ok(before.body.version, "status returns a server version");

  await create(TOK_A, { title: "cnt-" + crypto.randomUUID().slice(0, 8) });

  const afterB = await api("/api/status", { headers: authOf(TOK_B) });
  assert.equal(
    afterB.body.count,
    before.body.count,
    "a create by A must not change B's count"
  );
});

test("sync is isolated per user", async () => {
  const uuid = "sync-" + crypto.randomUUID();
  await api("/api/sync", {
    method: "POST",
    headers: jsonOf(TOK_A),
    body: JSON.stringify({ records: [syncRecord(uuid, { title: "A only" })] }),
  });

  const bSync = await api("/api/sync", {
    method: "POST",
    headers: jsonOf(TOK_B),
    body: JSON.stringify({ records: [] }),
  });
  assert.ok(
    !bSync.body.records.some((r) => r.uuid === uuid),
    "B's sync must not return A's record"
  );
});

test("a forged x-snipvault-user header cannot cross vaults", async () => {
  const marker = "spoof-" + crypto.randomUUID().slice(0, 8);
  await create(TOK_A, { title: marker });

  // B presents its own valid token but tries to assert it is user "a" via the
  // header. The middleware strips the inbound header, so B stays in B's vault.
  const bList = await api("/api/snippets", {
    headers: { ...authOf(TOK_B), "x-snipvault-user": "a" },
  });
  assert.ok(
    !bList.body.some((s) => s.title === marker),
    "a spoofed x-snipvault-user must be ignored; B stays in B's vault"
  );
});
