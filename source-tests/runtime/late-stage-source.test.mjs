import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");

test("exact WrapBox and stamp sources are frozen with provenance", async () => {
  const [wrap, wrapMeta, qc, qcMeta] = await Promise.all([
    read("integration/adapters/deploy-to-wrapbox/upstream-index.ts"),
    read("integration/adapters/deploy-to-wrapbox/SOURCE.json").then(JSON.parse),
    read("integration/legacy-reference/ProductionPackQCCard.tsx"),
    read("integration/legacy-reference/PRODUCTION_PACK_QC_SOURCE.json").then(JSON.parse),
  ]);
  assert.equal(sha(wrap), wrapMeta.retrievedSha256);
  assert.equal(sha(qc), qcMeta.retrievedSha256);
  assert.match(wrap, /WrapboxManifest/);
  assert.match(wrap, /send-design-pack-email/);
  assert.match(qc, /buildStampBlob/);
  assert.match(qc, /buildStampedProof/);
  assert.match(qc, /deploy-to-wrapbox/);
});
