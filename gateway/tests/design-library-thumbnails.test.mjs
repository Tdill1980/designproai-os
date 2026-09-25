import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "../src/server.mjs";

const env = { NODE_ENV: "test", SUPABASE_URL: "https://dp-project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const generationId = "99999999-9999-4999-8999-999999999999";
const sidePath = `designpro/user_${ownerId}/${generationId}/calls-1-7/side/${"a".repeat(64)}.jpg`;

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function libraryGateway({ calls, clock, transformOk = true, rows }) {
  return createGateway({
    env,
    now: () => clock.t,
    fetchImpl: async (url, init = {}) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.endsWith("/auth/v1/user")) return Response.json({ id: ownerId, email: "owner@designproai.com" });
      if (value.includes("/rest/v1/rpc/designpro_generation_library")) return Response.json(rows);
      if (value.includes("/storage/v1/object/sign/")) {
        const body = JSON.parse(init.body || "{}");
        if (body.transform) {
          if (!transformOk) return Response.json({ message: "transformations disabled" }, { status: 400 });
          return Response.json({ signedURL: `/render/image/sign/wrap-files/${sidePath}?token=thumb-${calls.length}` });
        }
        return Response.json({ signedURL: `/object/sign/wrap-files/${sidePath}?token=orig-${calls.length}` });
      }
      throw new Error(`unexpected ${value}`);
    },
  });
}
const row = (extra = {}) => ({ generationId, ownerId, thumbnailStoragePath: sidePath, state: "outputs_ready", viewCount: 7, ...extra });
const signCalls = (calls) => calls.filter((c) => c.url.includes("/storage/v1/object/sign/"));
const read = async (base, token = "test-token") => (await fetch(`${base}/api/design-library`, { headers: { cookie: `dp_session=${token}` } })).json();

test("library tiles are signed 640x360 transforms for an hour, and a repeat read reuses the same URL", async (t) => {
  const calls = [];
  const clock = { t: 1_000_000 };
  const server = libraryGateway({ calls, clock, rows: [row()] });
  t.after(() => server.close());
  const base = await listen(server);
  const first = await read(base);
  assert.equal(first.length, 1);
  assert.match(first[0].thumbnailUrl, /^https:\/\/dp-project\.supabase\.co\/storage\/v1\/render\/image\/sign\/wrap-files\//);
  assert.equal(first[0].expiresIn, 300, "the published lease stays a true lower bound");
  const [sign] = signCalls(calls);
  assert.deepEqual(JSON.parse(sign.init.body), { expiresIn: 3600, transform: { width: 640, height: 360, resize: "cover", quality: 60 } });
  assert.equal(sign.url, `https://dp-project.supabase.co/storage/v1/object/sign/wrap-files/${sidePath}`, "the same authorized object path");

  clock.t += 45 * 60_000; // 45 minutes later: 15 minutes left, still reused
  const second = await read(base);
  assert.equal(second[0].thumbnailUrl, first[0].thumbnailUrl, "a stable URL lets the browser and CDN cache the tile");
  assert.equal(signCalls(calls).length, 1, "no new sign call for a repeat library read");

  clock.t += 6 * 60_000; // under ten minutes left: re-signed before it can lapse
  const third = await read(base);
  assert.notEqual(third[0].thumbnailUrl, first[0].thumbnailUrl);
  assert.equal(signCalls(calls).length, 2);
});

test("a different session never receives another session's signed URL", async (t) => {
  const calls = [];
  const server = libraryGateway({ calls, clock: { t: 5_000 }, rows: [row()] });
  t.after(() => server.close());
  const base = await listen(server);
  const a = await read(base, "token-a");
  const b = await read(base, "token-b");
  assert.notEqual(a[0].thumbnailUrl, b[0].thumbnailUrl);
  assert.equal(signCalls(calls).length, 2);
});

test("if the transform cannot be signed, the tile falls back to the previous five-minute original", async (t) => {
  const calls = [];
  const server = libraryGateway({ calls, clock: { t: 5_000 }, transformOk: false, rows: [row()] });
  t.after(() => server.close());
  const base = await listen(server);
  const entries = await read(base);
  assert.match(entries[0].thumbnailUrl, /\/storage\/v1\/object\/sign\/wrap-files\/.*token=orig-/);
  const [transform, original] = signCalls(calls);
  assert.ok(JSON.parse(transform.init.body).transform);
  assert.deepEqual(JSON.parse(original.init.body), { expiresIn: 300 });
});

test("an unauthorized path is still never signed", async (t) => {
  const calls = [];
  const server = libraryGateway({ calls, clock: { t: 5_000 },
    rows: [row({ thumbnailStoragePath: `designpro/user_${ownerId}/${generationId}/flat-first/v1/master.png` })] });
  t.after(() => server.close());
  const base = await listen(server);
  const entries = await read(base);
  assert.equal(entries[0].thumbnailUrl, undefined);
  assert.equal(signCalls(calls).length, 0);
});
