import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createGenerationStore } = require("../../runtime/generation-store.cjs");

const CORE = [
  ["side", "driver"],
  ["passenger-side", "passenger"],
  ["hood_detail", "hood"],
  ["roof", "roof"],
  ["front", "front"],
  ["rear", "rear"],
];

function rowsFor(seventh) {
  return [...CORE, seventh].map(([source_view_type, consumer_role], index) => ({
    source_view_type,
    consumer_role,
    storage_path: `designpro/user_owner/generation/${source_view_type}-${index}.png`,
    content_hash: (index + 1).toString(16).repeat(64),
    byte_size: 100 + index,
    content_type: "image/png",
  }));
}

function storeFor(rows) {
  const query = {
    select() { return this; },
    eq() { return this; },
    is() { return Promise.resolve({ data: rows, error: null }); },
  };
  return createGenerationStore({
    workerId: "bridge-test",
    supabase: { from(table) { assert.equal(table, "designpro_generation_views"); return query; } },
  });
}

test("revision handoff projects exact Close-Up or historical Hero sets", async () => {
  for (const [seventh, expectedRole] of [
    [["close-up", "closeup"], "closeup"],
    [["hero-3d", "hero3d"], "hero3d"],
  ]) {
    const projected = await storeFor(rowsFor(seventh)).projectRevisionSources({ requestId: "request" });
    assert.deepEqual(Object.keys(projected).sort(), [...CORE.map(([, role]) => role), expectedRole].sort());
    assert.equal(expectedRole === "closeup" ? "hero3d" in projected : "closeup" in projected, false);
  }
});

test("revision handoff rejects both, neither, duplicate, and relabelled seventh slots", async () => {
  const closeup = rowsFor(["close-up", "closeup"]);
  const invalid = [
    [...closeup, rowsFor(["hero-3d", "hero3d"]).at(-1)],
    closeup.filter((row) => row.source_view_type !== "close-up"),
    [...closeup, { ...closeup[0] }],
    closeup.map((row) => row.source_view_type === "close-up"
      ? { ...row, consumer_role: "hero3d" }
      : row),
  ];
  for (const rows of invalid) {
    await assert.rejects(
      storeFor(rows).projectRevisionSources({ requestId: "request" }),
      /unknown or duplicate role|exactly one Close-Up or immutable historical Hero proof/,
    );
  }
});
