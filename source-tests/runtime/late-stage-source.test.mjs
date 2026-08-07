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
  assert.match(svg, /DESIGNPROAI · QUALITY CONTROL/);
  assert.match(svg, /QUALITY/);
  assert.match(svg, /APPROVED/);
  assert.match(svg, /DesignID: DID-1234ABCD/);
  assert.match(svg, /Order #: ORDER-240806-77/);
  assert.match(svg, /Quality Checked by Production QC/);
  assert.match(svg, /2026-08-06/);
});

test("released claimant deterministically composites and archives seal plus stamped proof", () => {
  assert.match(claimantSource, /stamped-call8-proof\.png/);
  assert.match(claimantSource, /composition: "deterministic-southeast-overlay\.v1"/);
  assert.match(claimantSource, /counts\.stamp !== 2/);
  assert.match(claimantSource, /identity\/design-order\.json/);
  assert.match(claimantSource, /"source-view": 7/);
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
