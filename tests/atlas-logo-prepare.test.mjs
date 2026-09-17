// ARCHITECTURE_DAG.md chunk 5 — `logo.prepare`.
//
// The customer's OWN logo, prepared as Layer 1 artwork. The node never generates
// a mark: with no upload there is no node, and the typography lockup is the
// brand mark, which is what buildLogoArchitecture() already directs on the
// prompt side.
//
// Two things this test exists to hold:
//
//   1. ANTI-DRIFT. The verification is `verifiedCustomerLogoPart`'s, in
//      runtime/flat-first-atlas.cjs, re-homed so a graph node can run it without
//      dragging in that module. Two homes for one rule drift -- CLAUDE.md
//      records what that has cost -- so this test reads THAT file's source and
//      asserts the error codes and the conditioning parameters still match.
//   2. NO MANUFACTURED TRANSPARENCY. A customer JPEG has no alpha, and keying a
//      white background out with a flood fill is the same fragile move CLAUDE.md
//      records failing on same-hue artwork. `hasAlpha` is recorded, not fixed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const runtimeRequire = createRequire(join(HERE, "..", "runtime", "package.json"));
const logo = runtimeRequire(join(HERE, "..", "runtime", "atlas-logo-prepare.cjs"));
const sharp = runtimeRequire("sharp");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

// The CODE is the contract downstream reads, not the sentence. Matching a regex
// against the message would pass on any error whose prose happened to contain
// the words.
const code = (expected) => (err) => {
  assert.equal(err.code, expected, `expected code ${expected}, got ${err.code} (${err.message})`);
  return true;
};

const supabaseServing = (bytes) => ({
  storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }, error: null }) }) },
});

async function pngFixture({ alpha }) {
  return sharp({
    create: { width: 300, height: 120, channels: alpha ? 4 : 3,
      background: alpha ? { r: 220, g: 40, b: 40, alpha: 0 } : { r: 255, g: 255, b: 255 } },
  }).png().toBuffer();
}

test("the verification is flat-first-atlas's, code for code — drift fails here", () => {
  const source = readFileSync(join(HERE, "..", "runtime", "flat-first-atlas.cjs"), "utf8");
  for (const code of ["flat_atlas_logo_identity_invalid", "flat_atlas_logo_download_failed", "flat_atlas_logo_hash_mismatch"]) {
    assert.ok(source.includes(code), `${code} must still be the code flat-first-atlas raises`);
  }
  // The conditioning parameters are load-bearing: a logo resized differently in
  // the two homes would composite at a different size than the prompt saw.
  const prepare = readFileSync(join(HERE, "..", "runtime", "atlas-logo-prepare.cjs"), "utf8");
  for (const fragment of ['fit: "inside"', "withoutEnlargement: true", 'kernel: "lanczos3"', "density: 300", ".rotate()"]) {
    assert.ok(source.includes(fragment), `${fragment} is expected in flat-first-atlas's logo conditioning`);
    assert.ok(prepare.includes(fragment), `${fragment} must match in atlas-logo-prepare`);
  }
  assert.ok(source.includes("40_000_000") && prepare.includes("40_000_000"), "the pixel ceiling must match");
});

test("absence is an honest answer, not a gap", () => {
  assert.equal(logo.hasCustomerLogo({}), false);
  assert.equal(logo.hasCustomerLogo({ logoAsset: null }), false);
  assert.equal(logo.hasCustomerLogo({ logoAsset: { storagePath: "x" } }), true);
});

test("a URL is not an identity", () => {
  for (const key of ["url", "signedUrl", "publicUrl", "downloadUrl"]) {
    assert.throws(
      () => logo.verifyLogoIdentity({ storagePath: "logos/a.png", contentHash: "a".repeat(64), byteSize: 10, [key]: "https://example.com/a.png" }),
      code("flat_atlas_logo_identity_invalid"),
      `${key} must be refused: wrap-files is private and a re-pointable reference is not an identity`,
    );
  }
});

test("an incomplete identity is refused before a lease is ever spent", () => {
  const good = { storagePath: "logos/a.png", contentHash: "a".repeat(64), byteSize: 10 };
  assert.deepEqual(logo.verifyLogoIdentity(good), good);
  for (const bad of [
    { ...good, storagePath: "  " },
    { ...good, contentHash: "not-a-hash" },
    { ...good, contentHash: "A".repeat(63) },
    { ...good, byteSize: 0 },
    { ...good, byteSize: 1.5 },
    { ...good, byteSize: "10" && Number.NaN },
  ]) {
    assert.throws(() => logo.verifyLogoIdentity(bad), code("flat_atlas_logo_identity_invalid"));
  }
});

test("bytes that do not match the sworn identity are refused", async () => {
  const bytes = await pngFixture({ alpha: true });
  await assert.rejects(
    () => logo.prepareCustomerLogo({
      supabase: supabaseServing(bytes),
      asset: { storagePath: "logos/a.png", contentHash: "b".repeat(64), byteSize: bytes.length },
    }),
    code("flat_atlas_logo_hash_mismatch"),
  );
  await assert.rejects(
    () => logo.prepareCustomerLogo({
      supabase: supabaseServing(bytes),
      asset: { storagePath: "logos/a.png", contentHash: sha256(bytes), byteSize: bytes.length + 1 },
    }),
    code("flat_atlas_logo_hash_mismatch"),
  );
});

test("a missing object is retryable, not a creative refusal", async () => {
  const supabase = { storage: { from: () => ({ download: async () => ({ data: null, error: { message: "not found" } }) }) } };
  await assert.rejects(
    () => logo.prepareCustomerLogo({ supabase, asset: { storagePath: "logos/a.png", contentHash: "a".repeat(64), byteSize: 10 } }),
    (err) => err.code === "flat_atlas_logo_download_failed" && err.retryable === true,
  );
});

test("alpha is RECORDED, never manufactured", async () => {
  const transparent = await pngFixture({ alpha: true });
  const opaque = await pngFixture({ alpha: false });

  const withAlpha = await logo.prepareCustomerLogo({
    supabase: supabaseServing(transparent),
    asset: { storagePath: "logos/a.png", contentHash: sha256(transparent), byteSize: transparent.length },
  });
  assert.equal(withAlpha.hasAlpha, true);
  assert.equal(withAlpha.source, "customer");
  assert.match(withAlpha.contentHash, /^[0-9a-f]{64}$/);
  assert.equal(withAlpha.width, 300);
  assert.equal(withAlpha.height, 120);

  const withoutAlpha = await logo.prepareCustomerLogo({
    supabase: supabaseServing(opaque),
    asset: { storagePath: "logos/b.png", contentHash: sha256(opaque), byteSize: opaque.length },
  });
  // A logo with no alpha is a FACT about the customer's file. Keying a white
  // background out here is the flood-key move CLAUDE.md records eating an
  // orange mark that touched an orange ribbon.
  assert.equal(withoutAlpha.hasAlpha, false, "transparency must never be invented");
});

test("conditioning never enlarges a small logo", async () => {
  const small = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const prepared = await logo.prepareCustomerLogo({
    supabase: supabaseServing(small),
    asset: { storagePath: "logos/s.png", contentHash: sha256(small), byteSize: small.length },
  });
  assert.equal(prepared.width, 64, "withoutEnlargement: a 64px logo stays 64px rather than being upscaled into mush");
  assert.equal(prepared.height, 32);
});
