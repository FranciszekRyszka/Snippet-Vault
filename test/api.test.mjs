// Integration tests for the SnipVault sync-server HTTP API.
//
// Black-box: they hit a running server over HTTP and assert on status + JSON,
// so they exercise the real request path (auth gate, routing, SQLite, sync
// merge). Run them via `node test/run-api-tests.mjs`, which boots a server on a
// throwaway database and points these at it — or against any server via
// SNIPVAULT_URL / SNIPVAULT_TOKEN. Zero dependencies (node:test + global fetch).
//
// The suite is self-cleaning: every row it creates is soft-deleted in an
// `after` hook, and the one sync record it pushes is tombstoned.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.SNIPVAULT_URL ?? "http://127.0.0.1:3999";
const TOKEN = process.env.SNIPVAULT_TOKEN ?? "";

const auth = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
const json = { "Content-Type": "application/json", ...auth };

// Autoincrement ids created during the run, torn down at the end.
const createdIds = [];

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  return { status: res.status, body };
}

function create(overrides = {}) {
  return api("/api/snippets", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      title: "test snippet",
      code: "x",
      language: "text",
      ...overrides,
    }),
  });
}

before(async () => {
  const { status, body } = await api("/api/health", { headers: auth });
  assert.equal(status, 200, "server must be up and the token accepted");
  assert.equal(body.ok, true);
});

after(async () => {
  for (const id of createdIds) {
    await fetch(`${BASE}/api/snippets/${id}`, { method: "DELETE", headers: auth });
  }
});

test("rejects a missing/bad token", async () => {
  // Only meaningful when the server is token-protected.
  if (!TOKEN) return;
  const res = await fetch(`${BASE}/api/health`, {
    headers: { Authorization: "Bearer wrong-token" },
  });
  assert.equal(res.status, 401);
});

test("rate-limits repeated bad-token attempts with a 429", async () => {
  // Only meaningful when the server is token-protected.
  if (!TOKEN) return;
  // Use a dedicated client bucket (x-forwarded-for) so tripping the limit here
  // can't throttle the rest of the suite, which sends no forwarded-for. The
  // runner sets SNIPVAULT_RATELIMIT_MAX=5, so the 6th failure is blocked.
  const ip = "203.0.113." + Math.floor(Math.random() * 200 + 1);
  const bad = () =>
    fetch(`${BASE}/api/health`, {
      headers: { Authorization: "Bearer wrong-token", "x-forwarded-for": ip },
    });
  for (let i = 0; i < 5; i++) {
    const res = await bad();
    assert.equal(res.status, 401, `attempt ${i + 1} should be a plain 401`);
  }
  const blocked = await bad();
  assert.equal(blocked.status, 429, "the 6th failure should be rate-limited");
  assert.ok(blocked.headers.get("retry-after"), "429 carries a Retry-After");
});

test("create defaults kind to prompt and returns a uuid", async () => {
  const { status, body } = await create({ title: "test create" });
  assert.equal(status, 201);
  assert.equal(body.kind, "prompt");
  assert.ok(body.id, "should have an autoincrement id");
  assert.ok(body.uuid, "should have a generated uuid");
  createdIds.push(body.id);
});

test("stores kind=code when asked", async () => {
  const { status, body } = await create({
    title: "test code",
    code: "const x = 1;",
    language: "javascript",
    kind: "code",
  });
  assert.equal(status, 201);
  assert.equal(body.kind, "code");
  createdIds.push(body.id);
});

test("rejects an invalid language with 400", async () => {
  const { status } = await create({ title: "bad", language: "not-a-lang" });
  assert.equal(status, 400);
});

test("rejects a missing required field with 400", async () => {
  const { status } = await api("/api/snippets", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ title: "no code", language: "text" }),
  });
  assert.equal(status, 400);
});

test("update replaces fields; 404 for a missing id", async () => {
  const created = await create({ title: "before" });
  createdIds.push(created.body.id);

  const upd = await api(`/api/snippets/${created.body.id}`, {
    method: "PUT",
    headers: json,
    body: JSON.stringify({
      title: "after",
      code: "y",
      language: "text",
      kind: "prompt",
    }),
  });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.title, "after");
  assert.equal(upd.body.code, "y");

  const missing = await api("/api/snippets/999999999", {
    method: "PUT",
    headers: json,
    body: JSON.stringify({ title: "x", code: "y", language: "text" }),
  });
  assert.equal(missing.status, 404);
});

test("pin toggles favorite via PATCH", async () => {
  const created = await create({ title: "pin me" });
  createdIds.push(created.body.id);

  const { status, body } = await api(`/api/snippets/${created.body.id}`, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify({ favorite: true }),
  });
  assert.equal(status, 200);
  assert.equal(body.favorite, true);
});

test("copy increments copy_count", async () => {
  const created = await create({ title: "copy me" });
  createdIds.push(created.body.id);

  const { status, body } = await api(`/api/snippets/${created.body.id}/copy`, {
    method: "POST",
    headers: auth,
  });
  assert.equal(status, 200);
  assert.equal(body.copy_count, 1);
});

test("soft delete hides the row from the list", async () => {
  const created = await create({ title: "delete me" });
  const id = created.body.id;

  const del = await api(`/api/snippets/${id}`, { method: "DELETE", headers: auth });
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { success: true });

  const list = await api("/api/snippets", { headers: auth });
  assert.ok(Array.isArray(list.body));
  assert.ok(!list.body.some((s) => s.id === id), "deleted row must not appear");
});

test("empty trash blanks tombstones and hides them from the Trash view", async () => {
  const created = await create({ title: "purge-me", code: "secret body" });
  const id = created.body.id;
  await api(`/api/snippets/${id}`, { method: "DELETE", headers: auth });

  // It shows in Trash before purging.
  let trash = await api("/api/snippets?deleted=1", { headers: auth });
  assert.ok(trash.body.some((s) => s.id === id), "deleted row is in Trash");

  // Empty the Trash.
  const purge = await api("/api/snippets/purge", { method: "POST", headers: auth });
  assert.equal(purge.status, 200);
  assert.ok(purge.body.purged >= 1, "reports how many were purged");

  // It's gone from Trash and never in the main list.
  trash = await api("/api/snippets?deleted=1", { headers: auth });
  assert.ok(!trash.body.some((s) => s.id === id), "purged tombstone hidden from Trash");
  const list = await api("/api/snippets", { headers: auth });
  assert.ok(!list.body.some((s) => s.id === id), "tombstone stays out of the main list");

  // But it survives (blanked) in the sync set so the deletion still propagates.
  const sync = await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ records: [] }),
  });
  const tomb = sync.body.records.find((r) => r.uuid === created.body.uuid);
  assert.ok(tomb, "tombstone kept for sync");
  assert.equal(tomb.deleted, true);
  assert.equal(tomb.title, "");
});

test("edits capture revisions; no-op saves don't", async () => {
  const created = await create({ title: "rev-v1", code: "body one" });
  const id = created.body.id;
  createdIds.push(id);

  const put = (title, code) =>
    api(`/api/snippets/${id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ title, code, language: "text" }),
    });

  // A fresh snippet has no history.
  let revs = await api(`/api/snippets/${id}/revisions`, { headers: auth });
  assert.equal(revs.status, 200);
  assert.equal(revs.body.length, 0);

  // First real edit captures the prior ("rev-v1") state.
  await put("rev-v2", "body two");
  revs = await api(`/api/snippets/${id}/revisions`, { headers: auth });
  assert.equal(revs.body.length, 1);
  assert.equal(revs.body[0].title, "rev-v1");
  assert.equal(revs.body[0].code, "body one");

  // A no-op save (identical content) adds nothing.
  await put("rev-v2", "body two");
  revs = await api(`/api/snippets/${id}/revisions`, { headers: auth });
  assert.equal(revs.body.length, 1, "no-op save must not add a revision");

  // A second edit captures "rev-v2", newest first.
  await put("rev-v3", "body three");
  revs = await api(`/api/snippets/${id}/revisions`, { headers: auth });
  assert.equal(revs.body.length, 2);
  assert.equal(revs.body[0].title, "rev-v2");
  assert.equal(revs.body[1].title, "rev-v1");
});

test("sort orders by the requested key, with a safe fallback", async () => {
  // Two uniquely-titled entries so we can spot them in a shared list; pin one
  // and give it copies so the sort keys are distinguishable.
  const tag = "sorttest-" + crypto.randomUUID().slice(0, 8);
  const a = await create({ title: `zzz ${tag}`, tags: [tag] });
  const b = await create({ title: `aaa ${tag}`, tags: [tag] });
  createdIds.push(a.body.id, b.body.id);
  // "aaa" (b) gets used the most and pinned, so it must lead every sort.
  await api(`/api/snippets/${b.body.id}/copy`, { method: "POST", headers: auth });
  await api(`/api/snippets/${b.body.id}`, {
    method: "PATCH",
    headers: json,
    body: JSON.stringify({ favorite: true }),
  });

  const only = (list) => list.body.filter((s) => (s.tags ?? []).includes(tag));

  // Alphabetical: pinned "aaa" still leads, then "zzz".
  const alpha = await api(`/api/snippets?sort=alpha&tag=${tag}`, { headers: auth });
  assert.deepEqual(
    only(alpha).map((s) => s.id),
    [b.body.id, a.body.id],
    "pin leads, then A→Z"
  );

  // Most-used: pinned + most-copied "aaa" leads.
  const most = await api(`/api/snippets?sort=most-used&tag=${tag}`, { headers: auth });
  assert.equal(only(most)[0].id, b.body.id, "pinned, most-used row leads");

  // An unknown sort key must not error — it falls back to the default order.
  const bad = await api(`/api/snippets?sort=%27%3B+DROP+TABLE+snippets%3B+--&tag=${tag}`, {
    headers: auth,
  });
  assert.equal(bad.status, 200);
  assert.equal(only(bad).length, 2, "garbage sort falls back safely");
});

test("tag rewrite renames, merges, and deletes across the library", async () => {
  const uniq = crypto.randomUUID().slice(0, 8);
  const from = `rw-${uniq}`;
  const other = `rw2-${uniq}`;
  const to = `rwnew-${uniq}`;
  const a = await create({ title: `tagrw a ${uniq}`, tags: [from, other] });
  const b = await create({ title: `tagrw b ${uniq}`, tags: [from] });
  createdIds.push(a.body.id, b.body.id);

  const tagsOf = async (id) => {
    const { body } = await api("/api/snippets", { headers: auth });
    const row = body.find((s) => s.id === id);
    return row ? row.tags : null;
  };

  // Rename `from` → `to` touches both rows.
  const renamed = await api("/api/tags", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ from, to }),
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.changed, 2);
  assert.deepEqual(await tagsOf(a.body.id), [to, other]);
  assert.deepEqual(await tagsOf(b.body.id), [to]);

  // Merge: rename `other` → `to` on a row that already has `to` dedupes.
  const merged = await api("/api/tags", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ from: other, to }),
  });
  assert.equal(merged.body.changed, 1);
  assert.deepEqual(await tagsOf(a.body.id), [to]);

  // Delete: `to: null` drops the tag everywhere.
  const deleted = await api("/api/tags", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ from: to, to: null }),
  });
  assert.equal(deleted.body.changed, 2);
  assert.deepEqual(await tagsOf(a.body.id), []);
  assert.deepEqual(await tagsOf(b.body.id), []);

  // A missing `from` is a 400.
  const bad = await api("/api/tags", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ to: "x" }),
  });
  assert.equal(bad.status, 400);
});

test("sync inserts a pushed record and echoes the merged set", async () => {
  const uuid = "test-" + crypto.randomUUID();
  const { status, body } = await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      records: [
        {
          uuid,
          title: "from sync test",
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
        },
      ],
    }),
  });
  assert.equal(status, 200);
  assert.ok(body.applied >= 1, "server should apply the new record");
  const mine = body.records.find((r) => r.uuid === uuid);
  assert.ok(mine, "server should echo back the record we pushed");
  assert.equal(mine.title, "from sync test");
  assert.equal(mine.kind, "prompt");

  // Tombstone it (sync has no numeric id) so it doesn't linger in the test DB.
  await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      records: [{ ...mine, deleted: true, updated_at: "2026-08-04 10:00:01" }],
    }),
  });
});

test("trash lists soft-deleted rows; restore brings them back", async () => {
  const created = await create({ title: "trash-me" });
  const id = created.body.id;
  await api(`/api/snippets/${id}`, { method: "DELETE", headers: auth });

  const trash = await api("/api/snippets?deleted=1", { headers: auth });
  assert.ok(Array.isArray(trash.body));
  assert.ok(
    trash.body.some((s) => s.id === id),
    "the deleted row should appear in trash"
  );

  // Restore by uuid (undelete in place) via the restore endpoint.
  const restored = await api("/api/snippets/restore", {
    method: "POST",
    headers: json,
    body: JSON.stringify(created.body),
  });
  assert.equal(restored.status, 201);
  createdIds.push(id);

  const trashAfter = await api("/api/snippets?deleted=1", { headers: auth });
  assert.ok(
    !trashAfter.body.some((s) => s.id === id),
    "the restored row should leave trash"
  );
  const list = await api("/api/snippets", { headers: auth });
  assert.ok(
    list.body.some((s) => s.id === id),
    "the restored row should be back in the main list"
  );
});

test("library round-trip: re-importing merges by uuid without duplicating", async () => {
  // Create two entries and read them back the way exportLibrary() would.
  const a = await create({ title: "lib-a" });
  const b = await create({ title: "lib-b", kind: "code", language: "javascript" });
  createdIds.push(a.body.id, b.body.id);

  const before = await api("/api/snippets", { headers: auth });
  const countBefore = before.body.length;

  // Map to the sync-record shape (drop id, add deleted:false) — exportLibrary's job.
  const records = before.body
    .filter((s) => s.id === a.body.id || s.id === b.body.id)
    .map(({ id, ...rest }) => ({ ...rest, deleted: false }));

  // Import the same records back (what importLibrary() does on the web path).
  const sync = await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ records }),
  });
  assert.equal(sync.status, 200);

  const after = await api("/api/snippets", { headers: auth });
  assert.equal(
    after.body.length,
    countBefore,
    "re-importing the same library must not create duplicates"
  );
});

test("older sync edit does not clobber a newer one (newest-wins)", async () => {
  const uuid = "test-" + crypto.randomUUID();
  const base = {
    uuid,
    title: "v-new",
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
    updated_at: "2026-08-04 12:00:00",
    deleted: false,
  };
  // Seed the newer version first.
  await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ records: [base] }),
  });
  // Push an OLDER edit; it must lose.
  const { body } = await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      records: [{ ...base, title: "v-old", updated_at: "2026-08-04 09:00:00" }],
    }),
  });
  const mine = body.records.find((r) => r.uuid === uuid);
  assert.equal(mine.title, "v-new", "the newer edit must be kept");

  await api("/api/sync", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      records: [{ ...base, deleted: true, updated_at: "2026-08-04 12:00:01" }],
    }),
  });
});
