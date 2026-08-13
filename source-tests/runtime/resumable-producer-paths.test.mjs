// uploadProducedBytes picks its transport by size alone: at or under
// MAX_STANDARD_UPLOAD_BYTES the bytes go out over the standard upload and the
// resumable allowlist never sees the path, above it they go over TUS and the
// path has to be named in that allowlist. So a directory that is only ever
// written small looks fine for as long as the vehicles stay small, and fails
// closed the first time one is big enough. Call 8's masters already shipped
// that way. These tests hold the two lists together instead.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { uploadSpoolWithTus } = require("../../runtime/zip-spool.cjs");

const runId = "11111111-1111-4111-8111-111111111111";
const tenant = "user_22222222-2222-4222-8222-222222222222";
const runPrefix = `designpro/${tenant}/${runId}/`;
const hash24 = "a".repeat(24);
const SURFACE_KEYS = ["driver", "passenger", "hood", "roof", "front", "rear"];

const spool = { contentHash: "b".repeat(64), byteSize: 1, filePath: "/tmp/not-reached" };
const supabase = {
  storage: {
    from() {
      return { download: () => Promise.resolve({ data: null, error: { status: 404, message: "not found" } }) };
    },
  },
};

// The endpoint is deliberately invalid, so a path that clears the allowlist
// dies at tus_endpoint_invalid without touching the network. Any other code
// means the path itself was rejected.
async function observedCode(storagePath, contentType = "image/png") {
  try {
    await uploadSpoolWithTus({
      supabase,
      supabaseUrl: "https://example.supabase.co",
      serviceRoleKey: "x".repeat(32),
      endpoint: "http://invalid.example/storage/v1/upload/resumable",
      spoolDir: "/tmp/not-reached",
      spool,
      storagePath,
      contentType,
    });
  } catch (error) {
    return error.code;
  }
  return null;
}

test("Call 9 cuts every surface to a path the resumable transport accepts", async () => {
  for (const key of SURFACE_KEYS) {
    assert.equal(await observedCode(`${runPrefix}panels/${key}.png`), "tus_endpoint_invalid", `panels/${key}.png must clear the allowlist`);
  }
});

test("Call 12 writes every upscaled surface to a path the resumable transport accepts", async () => {
  // Topaz targets (widthInches + 10) * 150 px, so an upscaled panel is always
  // far over the standard-upload threshold. This directory is never reached by
  // the non-resumable path at production size.
  for (const key of SURFACE_KEYS) {
    assert.equal(await observedCode(`${runPrefix}enhanced/${key}-${hash24}.png`), "tus_endpoint_invalid", `enhanced/${key}-… must clear the allowlist`);
  }
});

test("the resumable allowlist stays fail-closed around the new directories", async () => {
  assert.equal(await observedCode(`${runPrefix}panels/tailgate.png`), "tus_storage_path_invalid");
  assert.equal(await observedCode(`${runPrefix}panels/driver-${hash24}.png`), "tus_storage_path_invalid");
  assert.equal(await observedCode(`${runPrefix}enhanced/driver.png`), "tus_storage_path_invalid");
  assert.equal(await observedCode(`${runPrefix}enhanced/tailgate-${hash24}.png`), "tus_storage_path_invalid");
  assert.equal(await observedCode(`${runPrefix}scratch/driver.png`), "tus_storage_path_invalid");
});

test("every run directory the claimant can write over the threshold is in the allowlist", async () => {
  const claimant = await readFile(fileURLToPath(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url)), "utf8");
  const allowlist = await readFile(fileURLToPath(new URL("../../runtime/zip-spool.cjs", import.meta.url)), "utf8");
  const allowlistLine = allowlist.split("\n").find((line) => line.includes("tus_storage_path_invalid") || line.includes("const targetMatch"));
  assert.ok(allowlistLine, "could not locate the resumable allowlist");

  // Everything the claimant sends through uploadProducedBytes is size-routed,
  // so its run-relative directory has to be spelled somewhere in the allowlist.
  const producedPaths = [...claimant.matchAll(/uploadProducedBytes\(\s*sb,\s*run,\s*stage,\s*runtimeConfig,\s*([^,]+),/g)].map((match) => match[1].trim());
  assert.ok(producedPaths.length >= 3, "expected several size-routed producers in the claimant");

  const templates = [...claimant.matchAll(/`designpro\/\$\{tenantKey\(run\.tenant_key\)\}\/\$\{run\.id\}\/([^`]+)`/g)].map((match) => match[1]);
  const directories = new Set(templates.filter((tail) => tail.includes("/")).map((tail) => tail.slice(0, tail.indexOf("/"))));
  // source/ is copied inside Storage rather than uploaded, so it never reaches
  // this transport and is deliberately not allowlisted.
  directories.delete("source");
  assert.ok(directories.size >= 3, "expected the claimant to write several run subdirectories");

  const targetMatchSource = allowlist.slice(allowlist.indexOf("const targetMatch"), allowlist.indexOf("tus_storage_path_invalid"));
  for (const directory of directories) {
    assert.ok(targetMatchSource.includes(`${directory}\\/`), `claimant writes ${directory}/ but the resumable allowlist does not admit it`);
  }
});
