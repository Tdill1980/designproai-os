import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const claimant = require("../../runtime/designpro-standalone-claimant.cjs");
const delivery = require("../../runtime/wrapbox-delivery.cjs");
const deliverySource = readFileSync(new URL("../../runtime/wrapbox-delivery.cjs", import.meta.url), "utf8");
const claimantSource = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");

test("released standalone stamp visibly binds immutable business identity", () => {
  const svg = claimant._test.stampSvg(
    "Production QC",
    "DID-1234ABCD",
    "ORDER-240806-77",
    "2026-08-06",
  ).toString("utf8");
  // The ring caption is drawn as individually rotated glyphs, so the contiguous
  // string no longer appears in the markup. Asserting the string was exactly the
  // check that let the real defect through: it was a <textPath>, which librsvg
  // does not implement, so the caption matched here and rendered ZERO pixels on
  // every seal this server ever stamped. Assert the mechanism instead.
  assert.doesNotMatch(svg, /<textPath/, "librsvg renders no textPath -- the caption must not depend on one");
  for (const glyph of ["D", "E", "S", "I", "G", "N", "P", "R", "O", "A", "Q", "U", "L", "T", "Y", "C"]) {
    assert.match(svg, new RegExp(`<text[^>]*transform="rotate\\([^"]*"[^>]*>${glyph}</text>`),
      `ring caption is missing the glyph ${glyph}`);
  }
  assert.match(svg, /QUALITY/);
  assert.match(svg, /APPROVED/);
  assert.match(svg, /DesignID: DID-1234ABCD/);
  assert.match(svg, /Order #: ORDER-240806-77/);
  assert.match(svg, /Quality Checked by Production QC/);
  assert.match(svg, /2026-08-06/);
});

test("released claimant archives the seal, the stamped proof and the QC certificate", () => {
  assert.match(claimantSource, /stamped-call8-proof\.png/);
  assert.match(claimantSource, /composition: "deterministic-southeast-overlay\.v1"/);
  // The seal proves a permitted human signed. The certificate is the page that
  // says WHAT they signed -- the two checklists they actually ticked and the
  // per-side sizes from the bound GENIE manifest -- so a pack without it ships
  // an approval nobody downstream can read.
  assert.match(claimantSource, /qc-certificate\.png/);
  assert.match(claimantSource, /buildQcCertificatePng\(/);
  assert.match(claimantSource, /\[seal, stamped, certificate\]/);
  assert.match(claimantSource, /counts\.stamp !== 3/);
  assert.match(claimantSource, /identity\/design-order\.json/);
  // Seven when the Production Pack was bought -- they are its design proofs.
  assert.match(claimantSource, /"source-view": viewEntries\.length/);
  assert.match(claimantSource, /zipIncludesSourceViews: production/);
  assert.match(claimantSource, /"dimension-manifest": 1/);
});

test("released WrapBox v2 validator requires exact ZIP, DesignID, Order #, and logo identities", () => {
  assert.equal(delivery.MANIFEST_CONTRACT, "designpro.wrapbox-manifest.v2");
  for (const marker of [
    "manifest.designId !== businessIdentity?.designId",
    "manifest.orderNumber !== businessIdentity?.orderNumber",
    "manifest.zip.storagePath !== zipPath",
    "manifest.zip.contentHash",
    "manifest.zip.byteSize",
    "normalizeLogoInventory(manifest.logos",
  ]) assert.ok(deliverySource.includes(marker), marker);
  assert.match(deliverySource, /DesignID: \$\{payload\.designId\}/);
  assert.match(deliverySource, /Order #: \$\{payload\.orderNumber\}/);
});
